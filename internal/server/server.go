// Package server exposes todo files over HTTP: a JSON API that maps every
// request onto a `todomd` subprocess, plus the embedded single-page app.
//
// The server keeps no copy of any file. Each request re-reads through the
// CLI, so edits made by an agent (or by hand, or by git) are picked up on the
// next request without any watching, and each mutation is expressed in terms
// of a task ID rather than a whole-file write, so a stale browser tab can
// never clobber concurrent work.
//
// Several projects can be served at once; every board and task route names
// the project it acts on, so no request depends on a "currently selected"
// file living in the server.
package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/walm/todomd-web/internal/project"
	"github.com/walm/todomd-web/internal/todomd"
)

// DefaultCursor is the todomd change cursor this server reads from; it is
// separate from the TUI's and from any agent's, and todomd keeps one per
// file, so projects do not share unread state.
const DefaultCursor = "web"

// How often a board re-reads its file when nothing says otherwise. A local
// read is a few milliseconds; a remote one is an ssh round trip, so it is
// asked less often.
const (
	DefaultPollLocal  = 10 * time.Second
	DefaultPollRemote = 30 * time.Second
)

// pollFor returns how often this project should re-read, in the order a
// person would expect: the flag they passed this run, then what they wrote
// against that project, then their configured default, then ours.
func (s *Server) pollFor(entry project.Entry) time.Duration {
	switch {
	case s.poll != nil:
		return *s.poll
	case entry.Poll > 0:
		return entry.Poll
	}
	if configured, ok := s.registry.Poll(); ok {
		return configured
	}
	if entry.Remote() {
		return DefaultPollRemote
	}
	return DefaultPollLocal
}

// Options configures a Server.
type Options struct {
	Registry *project.Registry
	Bin      string       // todomd binary (default: "todomd" on PATH)
	Author   string       // default author for comments written through the UI
	Version  string       // todomd-web's own version, surfaced at /api/config
	Assets   http.Handler // serves the SPA; may be nil in tests
	Cursor   string       // change cursor name (default DefaultCursor)
	// Poll overrides the refresh interval for every project this run; nil
	// leaves it to the config file and the defaults below.
	Poll   *time.Duration
	Logger *slog.Logger
	// Restart replaces this process with a freshly started one, so an upgrade
	// applied from the browser takes effect without a terminal. nil means the
	// UI is told to restart it by hand.
	Restart func() error
}

// Server implements the HTTP API.
type Server struct {
	registry *project.Registry
	bin      string
	author   string
	ver      string
	assets   http.Handler
	cursor   string
	poll     *time.Duration
	log      *slog.Logger
	restart  func() error

	mu sync.Mutex
	// clients are made on first use and kept: one per project, each pinned to
	// its own file.
	clients map[string]*todomd.Client
	// self is, per project, the set of tasks this server changed since that
	// project's change feed was last read. Those events are dropped from
	// /api/changes so the UI badges an agent's work but not your own.
	self map[string]map[string]bool
}

// New builds a Server from opts.
func New(opts Options) *Server {
	s := &Server{
		registry: opts.Registry,
		bin:      opts.Bin,
		author:   opts.Author,
		ver:      opts.Version,
		assets:   opts.Assets,
		cursor:   opts.Cursor,
		poll:     opts.Poll,
		log:      opts.Logger,
		restart:  opts.Restart,
		clients:  map[string]*todomd.Client{},
		self:     map[string]map[string]bool{},
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
	route("GET", "/api/update", s.handleUpdate)
	route("POST", "/api/update", s.handleUpgrade)
	route("GET", "/api/projects", s.handleListProjects)
	route("POST", "/api/projects", s.handleAddProject)
	route("PATCH", "/api/projects/{project}", s.handleRenameProject)
	route("DELETE", "/api/projects/{project}", s.handleRemoveProject)

	const p = "/api/projects/{project}"
	route("GET", p+"/board", s.withProject(s.handleBoard))
	route("GET", p+"/changes", s.withProject(s.handleChanges))
	route("POST", p+"/tasks", s.withProject(s.handleCreateTask))
	route("PATCH", p+"/tasks/{id}", s.withProject(s.handleUpdateTask))
	route("DELETE", p+"/tasks/{id}", s.withProject(s.handleDeleteTask))
	route("POST", p+"/tasks/{id}/move", s.withProject(s.handleMoveTask))
	route("POST", p+"/tasks/{id}/comments", s.withProject(s.handleAddComment))

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, errorResponse{"no such endpoint"})
	})
	if s.assets != nil {
		mux.Handle("/", s.assets)
	}
	return mux
}

// projectHandler is a handler that has already had its project resolved.
type projectHandler func(http.ResponseWriter, *http.Request, project.Entry, *todomd.Client)

// withProject resolves the {project} segment to a registry entry and its
// client, so every handler below can assume both.
func (s *Server) withProject(h projectHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("project")
		entry, err := s.registry.Get(id)
		if err != nil {
			writeJSON(w, http.StatusNotFound, errorResponse{"no such project: " + id})
			return
		}
		client, err := s.clientFor(r, entry)
		if err != nil {
			s.writeError(w, err)
			return
		}
		h(w, r, entry, client)
	}
}

// clientFor returns the todomd client for a project, making it on first use.
func (s *Server) clientFor(r *http.Request, entry project.Entry) (*todomd.Client, error) {
	s.mu.Lock()
	client, ok := s.clients[entry.ID]
	s.mu.Unlock()
	if ok {
		return client, nil
	}
	// A project can name its own todomd — remote hosts often must, since an
	// ssh command runs a non-interactive shell.
	bin := entry.Bin
	if bin == "" {
		bin = s.bin
	}
	client, err := todomd.New(r.Context(), bin, entry.Address())
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Another request may have got there first; either client is equivalent.
	if existing, ok := s.clients[entry.ID]; ok {
		return existing, nil
	}
	s.clients[entry.ID] = client
	return client, nil
}

// rekey moves a renamed project's cached client and unread bookkeeping to its
// new id, so a rename does not lose track of what this server changed.
func (s *Server) rekey(from, to string) {
	if from == to {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if client, ok := s.clients[from]; ok {
		s.clients[to] = client
		delete(s.clients, from)
	}
	if own, ok := s.self[from]; ok {
		s.self[to] = own
		delete(s.self, from)
	}
}

// forget drops a removed project's cached client and unread bookkeeping.
func (s *Server) forget(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.clients, id)
	delete(s.self, id)
}

// markSelf records that this server changed a task, so the project's change
// feed can suppress the resulting event.
func (s *Server) markSelf(projectID, taskID string) {
	if taskID == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.self[projectID] == nil {
		s.self[projectID] = map[string]bool{}
	}
	s.self[projectID][taskID] = true
}

// takeSelf returns and clears a project's set of self-changed task IDs.
func (s *Server) takeSelf(projectID string) map[string]bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	own := s.self[projectID]
	delete(s.self, projectID)
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
