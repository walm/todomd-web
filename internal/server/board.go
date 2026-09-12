package server

import (
	"errors"
	"net/http"

	"github.com/walm/todomd-web/internal/project"
	"github.com/walm/todomd-web/internal/todomd"
)

type configResponse struct {
	Author        string `json:"author"`
	Version       string `json:"version"`
	TodomdVersion string `json:"todomdVersion"`
	// Configurable is false when the project list came from the command line,
	// which is when the UI hides its add and remove controls.
	Configurable bool   `json:"configurable"`
	ConfigFile   string `json:"configFile"`
	// PollMs is the default refresh interval in milliseconds, 0 when off.
	PollMs int64 `json:"pollMs"`
	// AttachmentMaxBytes caps one attached file, so the UI can refuse a
	// too-large one before uploading it.
	AttachmentMaxBytes int64 `json:"attachmentMaxBytes"`
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	version := "unknown"
	// Any project's client can answer this; they all run the same binary.
	if entries := s.registry.List(); len(entries) > 0 {
		if client, err := s.clientFor(r, entries[0]); err == nil {
			version = client.Version(r.Context())
		}
	}
	poll := DefaultPollLocal
	if entries := s.registry.List(); len(entries) > 0 {
		poll = s.pollFor(entries[0])
	} else if s.poll != nil {
		poll = *s.poll
	}
	writeJSON(w, http.StatusOK, configResponse{
		PollMs:             poll.Milliseconds(),
		AttachmentMaxBytes: s.maxAttachment,
		Author:             s.author,
		Version:            s.ver,
		TodomdVersion:      version,
		Configurable:       s.registry.Configurable(),
		ConfigFile:         s.registry.Path(),
	})
}

type boardResponse struct {
	Project string         `json:"project"`
	File    string         `json:"file"`
	Rev     string         `json:"rev"`
	Boards  []todomd.Board `json:"boards"`
}

func (s *Server) handleBoard(w http.ResponseWriter, r *http.Request, entry project.Entry, client *todomd.Client) {
	f, err := client.List(r.Context())
	if err != nil {
		s.writeError(w, err)
		return
	}
	s.sweepAttachments(entry, f)
	writeJSON(w, http.StatusOK, boardResponse{
		Project: entry.ID,
		File:    f.Path,
		Rev:     client.Rev(),
		Boards:  f.Boards,
	})
}

type deleteBoardResponse struct {
	Project string        `json:"project"`
	Board   string        `json:"board"`
	Tasks   []todomd.Task `json:"tasks"`
	Rev     string        `json:"rev"`
}

// handleDeleteBoard removes a board. An empty one goes on request; one that
// still holds tasks needs ?force=true, because todomd deletes those tasks with
// it — the UI asks first, and this refuses with 409 if it did not, which also
// covers the board having gained a task since the UI last looked.
func (s *Server) handleDeleteBoard(w http.ResponseWriter, r *http.Request, entry project.Entry, client *todomd.Client) {
	name := r.PathValue("board")
	force := r.URL.Query().Get("force") == "true"

	gone, err := client.DeleteBoard(r.Context(), name, force)
	if err != nil {
		var cli *todomd.Error
		switch {
		case errors.As(err, &cli) && cli.BoardNotEmpty():
			writeJSON(w, http.StatusConflict, errorResponse{cli.Error()})
		case errors.As(err, &cli) && cli.NoSuchBoard():
			writeJSON(w, http.StatusNotFound, errorResponse{cli.Error()})
		default:
			s.writeError(w, err)
		}
		return
	}

	// The tasks went with the board; they are this server's doing, so they
	// should not come back as somebody else's unread changes.
	for _, t := range gone.Tasks {
		s.markSelf(entry.ID, t.ID)
		s.forgetAttachments(entry, t.ID)
	}
	s.log.Info("deleted board", "project", entry.ID, "board", gone.Board, "tasks", len(gone.Tasks))
	writeJSON(w, http.StatusOK, deleteBoardResponse{
		Project: entry.ID, Board: gone.Board, Tasks: gone.Tasks, Rev: client.Rev(),
	})
}

type changesResponse struct {
	Project     string         `json:"project"`
	Rev         string         `json:"rev"`
	Initialized bool           `json:"initialized"`
	Events      []todomd.Event `json:"events"`
}

// handleChanges reports what changed in one project since this server last
// looked, dropping the events it caused itself. Reading advances todomd's
// cursor for that file, so each event is delivered once.
func (s *Server) handleChanges(w http.ResponseWriter, r *http.Request, entry project.Entry, client *todomd.Client) {
	ch, err := client.Changes(r.Context(), s.cursor, false)
	if err != nil {
		s.writeError(w, err)
		return
	}
	own := s.takeSelf(entry.ID)
	events := []todomd.Event{}
	for _, e := range ch.Events {
		// Whoever deleted it — an agent, the TUI, a git pull — its
		// attachments go with it.
		if e.Type == todomd.TaskDeleted {
			s.forgetAttachments(entry, e.TaskID)
		}
		if own[e.TaskID] {
			continue
		}
		events = append(events, e)
	}
	writeJSON(w, http.StatusOK, changesResponse{
		Project:     entry.ID,
		Rev:         client.Rev(),
		Initialized: ch.Initialized,
		Events:      events,
	})
}
