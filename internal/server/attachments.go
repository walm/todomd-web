package server

import (
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/walm/todomd-web/internal/attach"
	"github.com/walm/todomd-web/internal/project"
	"github.com/walm/todomd-web/internal/todomd"
)

// maxAttachmentsPerRequest bounds one upload: a paste or a drop is a handful
// of files, not a directory.
const maxAttachmentsPerRequest = 10

// sweepEvery is how often a project's attachments are checked against its
// file, at most. The sweep is one directory listing, but it runs from board
// reads, which arrive every few seconds.
const sweepEvery = 10 * time.Minute

type attachmentsResponse struct {
	Project     string         `json:"project"`
	Attachments []attach.Saved `json:"attachments"`
}

// attachable reports why a project cannot take attachments, or "" when it
// can. A remote project cannot yet: the link written into its file would name
// a path on this machine, which the agent working over there does not have.
func (s *Server) attachable(entry project.Entry) string {
	switch {
	case s.store == nil:
		return "attachments are unavailable: there is no state directory to keep them in"
	case entry.Remote():
		return "attachments are not available for projects over ssh yet: the link would name a file on this machine, which " + entry.Host + " does not have"
	}
	return ""
}

// handleUploadAttachment stores the files in a multipart body against a task
// and returns, for each, the markdown to put in a description or comment. It
// does not touch the todo file: the editor inserts the link, and the ordinary
// update or comment call writes it, so an abandoned paste never edits the
// file.
func (s *Server) handleUploadAttachment(w http.ResponseWriter, r *http.Request, entry project.Entry, client *todomd.Client) {
	if why := s.attachable(entry); why != "" {
		s.writeError(w, invalid(why))
		return
	}
	// The task has to exist, so the tree cannot be seeded with directories
	// for ids that never will; resolving it also turns a prefix into the id.
	task, err := client.Show(r.Context(), r.PathValue("id"))
	if err != nil {
		s.writeError(w, err)
		return
	}
	s.receive(w, r, entry, func(name string, body io.Reader) (attach.Saved, error) {
		return s.store.Save(entry.File, task.ID, name, body, s.maxAttachment)
	})
}

// handleUploadDraftAttachment stores files for a task still being written: the
// new-task dialog has nothing to attach to until todomd assigns an id. The
// browser picks a random draft id, and creating the task with it hands the
// files over (see claimDraft). A draft that never becomes a task is swept
// after attach.DraftTTL.
func (s *Server) handleUploadDraftAttachment(w http.ResponseWriter, r *http.Request, entry project.Entry, _ *todomd.Client) {
	if why := s.attachable(entry); why != "" {
		s.writeError(w, invalid(why))
		return
	}
	draft := r.PathValue("draft")
	if !attach.ValidDraft(draft) {
		s.writeError(w, invalid("a draft id is 16 to 64 lowercase letters and digits"))
		return
	}
	s.receive(w, r, entry, func(name string, body io.Reader) (attach.Saved, error) {
		return s.store.SaveDraft(entry.File, draft, name, body, s.maxAttachment)
	})
}

// receive streams the files of a multipart body through save and answers with
// what was stored.
func (s *Server) receive(w http.ResponseWriter, r *http.Request, entry project.Entry, save func(name string, body io.Reader) (attach.Saved, error)) {
	r.Body = http.MaxBytesReader(w, r.Body, maxAttachmentsPerRequest*s.maxAttachment+1<<20)
	parts, err := r.MultipartReader()
	if err != nil {
		s.writeError(w, invalid("expected a multipart/form-data body with one or more \"file\" parts"))
		return
	}

	saved := []attach.Saved{}
	fail := func(status int, msg string) {
		// All or nothing: a half-landed drop would leave files the editor
		// never linked.
		for _, a := range saved {
			s.store.Discard(a)
		}
		writeJSON(w, status, errorResponse{msg})
	}
	for {
		part, err := parts.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				fail(http.StatusRequestEntityTooLarge, "upload is too large")
				return
			}
			fail(http.StatusBadRequest, "invalid multipart body: "+err.Error())
			return
		}
		if part.FormName() != "file" || part.FileName() == "" {
			part.Close()
			continue
		}
		if len(saved) == maxAttachmentsPerRequest {
			part.Close()
			fail(http.StatusBadRequest, "too many files in one upload")
			return
		}
		a, err := save(part.FileName(), part)
		part.Close()
		if err != nil {
			var tooBig *http.MaxBytesError
			switch {
			case errors.Is(err, attach.ErrTooLarge), errors.As(err, &tooBig):
				fail(http.StatusRequestEntityTooLarge, part.FileName()+" is larger than "+humanBytes(s.maxAttachment))
			default:
				s.log.Error("saving attachment", "project", entry.ID, "err", err)
				fail(http.StatusInternalServerError, "could not save "+part.FileName()+": "+err.Error())
			}
			return
		}
		saved = append(saved, a)
	}
	if len(saved) == 0 {
		s.writeError(w, invalid("no file in the upload"))
		return
	}
	s.log.Info("attached", "project", entry.ID, "files", len(saved))
	writeJSON(w, http.StatusCreated, attachmentsResponse{Project: entry.ID, Attachments: saved})
}

// claimDraft gives a draft's attachments to the task just created from it and
// points the description's links at their new home. That is a second write,
// and it cannot be avoided: todomd assigns the id, so the final path is not
// known until the task exists. Nothing here fails the create — the task is
// already in the file, and an error would invite a duplicate — and every
// failure leaves the links resolving: the files stay at the draft's path until
// the description no longer names it.
func (s *Server) claimDraft(ctx context.Context, entry project.Entry, client *todomd.Client, draft string, t *todomd.Task) *todomd.Task {
	if s.attachable(entry) != "" {
		return t
	}
	from, to, err := s.store.Claim(entry.File, draft, t.ID)
	if err != nil {
		s.log.Warn("claiming draft attachments", "project", entry.ID, "task", t.ID, "err", err)
		return t
	}
	if from == "" {
		return t
	}
	sep := string(filepath.Separator)
	if desc := strings.ReplaceAll(t.Description, from+sep, to+sep); desc != t.Description {
		updated, err := client.Update(ctx, t.ID, todomd.Update{Description: &desc})
		if err != nil {
			s.log.Warn("pointing links at the new task", "project", entry.ID, "task", t.ID, "err", err)
			_ = s.store.RemoveTask(entry.File, t.ID)
			return t
		}
		t = updated
	}
	if err := s.store.RemoveDraft(entry.File, draft); err != nil {
		s.log.Warn("removing claimed draft", "project", entry.ID, "draft", draft, "err", err)
	}
	return t
}

// handleServeAttachment returns a stored file. The URL only ever names a task
// and a file; the store resolves both, so nothing in the request becomes a
// path. What comes back is inert: its type is decided by the extension, the
// browser is told not to sniff, and a direct visit runs in a sandbox.
func (s *Server) handleServeAttachment(w http.ResponseWriter, r *http.Request, entry project.Entry, _ *todomd.Client) {
	if s.attachable(entry) != "" {
		writeJSON(w, http.StatusNotFound, errorResponse{attach.ErrNotFound.Error()})
		return
	}
	name := r.PathValue("name")
	f, info, err := s.store.Open(entry.File, r.PathValue("task"), name)
	if err != nil {
		writeJSON(w, http.StatusNotFound, errorResponse{attach.ErrNotFound.Error()})
		return
	}
	defer f.Close()

	disposition := "attachment"
	if attach.Inline(name) {
		disposition = "inline"
	}
	h := w.Header()
	h.Set("Content-Type", attach.TypeOf(name))
	h.Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": name}))
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	h.Set("Cache-Control", "private, no-cache")
	http.ServeContent(w, r, name, info.ModTime(), f)
}

// forgetAttachments removes what was attached to tasks that are gone. Failing
// is logged, never reported: a leftover file is not worth a failed delete.
func (s *Server) forgetAttachments(entry project.Entry, ids ...string) {
	if s.attachable(entry) != "" {
		return
	}
	for _, id := range ids {
		if err := s.store.RemoveTask(entry.File, id); err != nil {
			s.log.Warn("removing attachments", "project", entry.ID, "task", id, "err", err)
		}
	}
}

// sweeper throttles sweeps per todo file, and keeps two from running at once
// for the same one.
type sweeper struct {
	mu   sync.Mutex
	last map[string]time.Time
}

// sweepAttachments removes the attachments of tasks no longer in f, at most
// every sweepEvery per file. This is the net under the direct removals: it
// catches a task deleted by an agent, the TUI or a git pull while no browser
// was reading the change feed. f must be a successful read — never call it
// with a board that failed to load.
func (s *Server) sweepAttachments(entry project.Entry, f *todomd.File) {
	if s.attachable(entry) != "" || f == nil {
		return
	}
	s.sweeps.mu.Lock()
	defer s.sweeps.mu.Unlock()
	if time.Since(s.sweeps.last[entry.File]) < sweepEvery {
		return
	}
	s.sweeps.last[entry.File] = time.Now()

	live := map[string]bool{}
	for _, b := range f.Boards {
		for _, t := range b.Tasks {
			live[t.ID] = true
		}
	}
	removed, err := s.store.Sweep(entry.File, live)
	if err != nil {
		s.log.Warn("sweeping attachments", "project", entry.ID, "err", err)
	}
	if len(removed) > 0 {
		s.log.Info("swept attachments", "project", entry.ID, "tasks", removed)
	}
}

func humanBytes(n int64) string {
	const mb = 1 << 20
	if n >= mb && n%mb == 0 {
		return strconv.FormatInt(n/mb, 10) + " MB"
	}
	return strconv.FormatInt(n, 10) + " bytes"
}
