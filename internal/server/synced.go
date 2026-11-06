package server

import (
	"context"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/walm/todomd-web/internal/attach"
	"github.com/walm/todomd-web/internal/project"
	"github.com/walm/todomd-web/internal/todomd"
)

// Images synced with todomd.online. When a todo file is linked to a
// todomd.online project, todomd keeps the project's images in a folder of its
// own and links them from the file by absolute path, the way todomd-web links
// its attachments. todomd says where that folder is (`todomd sync status
// --json`); the board shows the images in it through the route below.

// syncedTTL is how long the folder todomd reported is trusted before asking
// again: it changes only when the file is linked or unlinked, and asking
// costs a todomd process per project on every project listing.
const syncedTTL = 30 * time.Second

type syncedFolder struct {
	dir string
	at  time.Time
}

// syncedImages returns the folder holding the images of the todomd.online
// project the file is linked to, or "" when it isn't linked, todomd is too
// old to sync, or the project is on another machine.
func (s *Server) syncedImages(r *http.Request, entry project.Entry) string {
	if entry.Remote() {
		return ""
	}
	s.mu.Lock()
	cached, ok := s.synced[entry.File]
	s.mu.Unlock()
	if ok && time.Since(cached.at) < syncedTTL {
		return cached.dir
	}
	dir := ""
	if client, err := s.clientFor(r, entry); err == nil {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		if st, err := client.SyncStatus(ctx); err == nil && st != nil && filepath.IsAbs(st.Attachments) {
			dir = filepath.Clean(st.Attachments)
		}
		cancel()
	}
	s.mu.Lock()
	s.synced[entry.File] = syncedFolder{dir: dir, at: time.Now()}
	s.mu.Unlock()
	return dir
}

var (
	syncedAttRe  = regexp.MustCompile(`^att_[0-9a-f]{20}$`)
	syncedNameRe = regexp.MustCompile(`^[A-Za-z0-9_-](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$`)
	// The image types todomd.online stores; no SVG, which can carry script.
	syncedTypes = map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true}
)

// handleServeSyncedImage serves <folder>/<att>/<name> from the project's
// synced-images folder: only names todomd writes, only image types, only a
// regular file whose real path is inside the folder, and inert, like an
// attachment.
func (s *Server) handleServeSyncedImage(w http.ResponseWriter, r *http.Request, entry project.Entry, _ *todomd.Client) {
	notFound := func() { writeJSON(w, http.StatusNotFound, errorResponse{attach.ErrNotFound.Error()}) }
	att, name := r.PathValue("att"), r.PathValue("name")
	if !syncedAttRe.MatchString(att) || !syncedNameRe.MatchString(name) || !syncedTypes[strings.ToLower(filepath.Ext(name))] {
		notFound()
		return
	}
	dir := s.syncedImages(r, entry)
	if dir == "" {
		notFound()
		return
	}
	dirReal, err := filepath.EvalSymlinks(dir)
	if err != nil {
		notFound()
		return
	}
	real, err := filepath.EvalSymlinks(filepath.Join(dir, att, name))
	if err != nil || real != filepath.Join(dirReal, att, name) {
		notFound()
		return
	}
	f, err := os.Open(real)
	if err != nil {
		notFound()
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		notFound()
		return
	}
	h := w.Header()
	h.Set("Content-Type", attach.TypeOf(name))
	h.Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": name}))
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	h.Set("Cache-Control", "private, no-cache")
	http.ServeContent(w, r, name, info.ModTime(), f)
}
