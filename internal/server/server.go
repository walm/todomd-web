// Package server exposes a todo file over HTTP: a JSON API that maps every
// request onto a `todomd` subprocess, plus the embedded single-page app.
//
// The server keeps no copy of the file. Each request re-reads through the
// CLI, so edits made by an agent (or by hand, or by git) are picked up on the
// next request without any watching, and each mutation is expressed in terms
// of a task ID rather than a whole-file write, so a stale browser tab can
// never clobber concurrent work.
package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"

	"github.com/walm/todomd-web/internal/todomd"
)

// DefaultCursor is the todomd change cursor this server reads from; it is
// separate from the TUI's and from any agent's.
const DefaultCursor = "web"

// Options configures a Server.
type Options struct {
	Client  *todomd.Client
	Author  string       // default author for comments written through the UI
	Version string       // todomd-web's own version, surfaced at /api/config
	Assets  http.Handler // serves the SPA; may be nil in tests
	Cursor  string       // change cursor name (default DefaultCursor)
	Logger  *slog.Logger
}

// Server implements the HTTP API.
type Server struct {
	client *todomd.Client
	author string
	ver    string
	assets http.Handler
	cursor string
	log    *slog.Logger

	// mu guards self, the set of tasks this server changed since the change
	// feed was last read. Those events are dropped from /api/changes so the
	// UI badges an agent's work but not your own.
	mu   sync.Mutex
	self map[string]bool
}

// New builds a Server from opts.
func New(opts Options) *Server {
	s := &Server{
		client: opts.Client,
		author: opts.Author,
		ver:    opts.Version,
		assets: opts.Assets,
		cursor: opts.Cursor,
		log:    opts.Logger,
		self:   map[string]bool{},
	}
	if s.author == "" {
		s.author = "user"
	}
	if s.cursor == "" {
		s.cursor = DefaultCursor
	}
	if s.log == nil {
		s.log = slog.Default()
	}
	return s
}

// Handler returns the router for the API and the SPA.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	// route registers a handler and, for the same path, a method-agnostic
	// fallback: without it the catch-all below would answer a wrong method on
	// a known path with 404 instead of 405.
	paths := map[string]bool{}
	route := func(method, path string, h http.HandlerFunc) {
		mux.HandleFunc(method+" "+path, h)
		if !paths[path] {
			paths[path] = true
			mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
				writeJSON(w, http.StatusMethodNotAllowed, errorResponse{r.Method + " not allowed here"})
			})
		}
	}
	route("GET", "/api/config", s.handleConfig)
	route("GET", "/api/board", s.handleBoard)
	route("GET", "/api/changes", s.handleChanges)
	route("POST", "/api/tasks", s.handleCreateTask)
	route("PATCH", "/api/tasks/{id}", s.handleUpdateTask)
	route("DELETE", "/api/tasks/{id}", s.handleDeleteTask)
	route("POST", "/api/tasks/{id}/move", s.handleMoveTask)
	route("POST", "/api/tasks/{id}/comments", s.handleAddComment)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, errorResponse{"no such endpoint"})
	})
	if s.assets != nil {
		mux.Handle("/", s.assets)
	}
	return mux
}

// markSelf records that this server changed a task, so the change feed can
// suppress the resulting event.
func (s *Server) markSelf(id string) {
	if id == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.self[id] = true
}

// takeSelf returns and clears the set of self-changed task IDs.
func (s *Server) takeSelf() map[string]bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	own := s.self
	s.self = map[string]bool{}
	return own
}

type errorResponse struct {
	Error string `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}
