package server

import (
	"errors"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/walm/todomd-web/internal/project"
	"github.com/walm/todomd-web/internal/todomd"
)

type projectJSON struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	File string `json:"file"`
	Dir  string `json:"dir"`
	// Host is set for a project on another machine, so the switcher can say so.
	Host string `json:"host,omitempty"`
	// Available is false when the file has been moved or deleted since it was
	// listed. The switcher greys those out instead of the board breaking.
	// A remote file is taken on trust: checking would be an ssh round trip per
	// project on every list, and the board reports the real error when opened.
	Available bool `json:"available"`
	// PollMs is how often this project re-reads itself, in milliseconds; 0
	// means the board only refreshes on focus or on request.
	PollMs int64 `json:"pollMs"`
}

type projectsResponse struct {
	Projects     []projectJSON `json:"projects"`
	Configurable bool          `json:"configurable"`
}

func (s *Server) describe(entry project.Entry) projectJSON {
	out := describe(entry)
	out.PollMs = s.pollFor(entry).Milliseconds()
	return out
}

func describe(entry project.Entry) projectJSON {
	out := projectJSON{
		ID:        entry.ID,
		Name:      entry.Name,
		File:      entry.File,
		Host:      entry.Host,
		Available: true,
	}
	if entry.Remote() {
		addr, err := todomd.ParseAddress(entry.File)
		if err == nil {
			out.Dir = addr.Host + ":" + path.Dir(addr.Path)
		}
		return out
	}
	out.Dir = filepath.Dir(entry.File)
	info, err := os.Stat(entry.File)
	out.Available = err == nil && info.Mode().IsRegular()
	return out
}

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	out := projectsResponse{Projects: []projectJSON{}, Configurable: s.registry.Configurable()}
	for _, entry := range s.registry.List() {
		out.Projects = append(out.Projects, s.describe(entry))
	}
	writeJSON(w, http.StatusOK, out)
}

type addProjectRequest struct {
	File string `json:"file"`
	Name string `json:"name"`
	// Create runs `todomd init` when the file does not exist yet.
	Create bool `json:"create"`
	// Todomd is this project's todomd binary, for a remote host whose
	// non-interactive PATH does not have it.
	Todomd string `json:"todomd"`
}

// handleAddProject puts an existing todo file on the list, optionally
// creating it first. A path naming a directory is taken to mean TODO.md
// inside it, which is what people type.
func (s *Server) handleAddProject(w http.ResponseWriter, r *http.Request) {
	var req addProjectRequest
	if err := decode(r, &req); err != nil {
		s.writeError(w, err)
		return
	}
	raw := strings.TrimSpace(req.File)
	if raw == "" {
		s.writeError(w, invalid("a file path is required"))
		return
	}
	addr, err := todomd.ParseAddress(raw)
	if err != nil {
		s.writeError(w, invalid(err.Error()))
		return
	}
	if addr.Remote() {
		s.addRemoteProject(w, r, addr, req)
		return
	}

	path := addr.Path
	if strings.HasPrefix(raw, "~/") {
		home, err := os.UserHomeDir()
		if err == nil {
			path = filepath.Join(home, raw[2:])
		}
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		s.writeError(w, invalid(err.Error()))
		return
	}
	// A path that names a directory — or that does not exist yet and does not
	// look like a markdown file — means TODO.md inside it, which is what
	// people type. Without this, "create" would happily make a file called
	// "gamma" with no extension.
	info, err := os.Stat(abs)
	switch {
	case err == nil && info.IsDir():
		abs = filepath.Join(abs, "TODO.md")
	case os.IsNotExist(err) && !strings.EqualFold(filepath.Ext(abs), ".md"):
		abs = filepath.Join(abs, "TODO.md")
	}

	if _, err := os.Stat(abs); os.IsNotExist(err) {
		if !req.Create {
			s.writeError(w, invalid(abs+" does not exist"))
			return
		}
		if err := todomd.Init(r.Context(), s.bin, abs); err != nil {
			s.writeError(w, err)
			return
		}
	}

	entry, err := s.registry.Add(abs, req.Name, req.Todomd)
	if err != nil {
		if errors.Is(err, project.ErrNotConfigurable) {
			writeJSON(w, http.StatusConflict, errorResponse{err.Error()})
			return
		}
		s.writeError(w, invalid(err.Error()))
		return
	}
	writeJSON(w, http.StatusCreated, s.describe(entry))
}

type renameProjectRequest struct {
	Name string `json:"name"`
}

// handleRenameProject changes a project's name. The id changes with it, so
// the response is the project's new identity and the caller has to follow it.
func (s *Server) handleRenameProject(w http.ResponseWriter, r *http.Request) {
	var req renameProjectRequest
	if err := decode(r, &req); err != nil {
		s.writeError(w, err)
		return
	}
	id := r.PathValue("project")
	entry, err := s.registry.Rename(id, req.Name)
	switch {
	case err == nil:
		// The cached client is keyed by id; drop the old key so it is not
		// left pointing at a project that no longer answers to that name.
		s.rekey(id, entry.ID)
		writeJSON(w, http.StatusOK, s.describe(entry))
	case errors.Is(err, project.ErrNotFound):
		writeJSON(w, http.StatusNotFound, errorResponse{"no such project: " + id})
	case errors.Is(err, project.ErrNotConfigurable):
		writeJSON(w, http.StatusConflict, errorResponse{err.Error()})
	default:
		s.writeError(w, invalid(err.Error()))
	}
}

// addRemoteProject lists the board over ssh before putting it on the list:
// nothing here can stat a file on another machine, and finding out now — with
// todomd's own message, or ssh's — beats a project that only fails when you
// open it.
func (s *Server) addRemoteProject(w http.ResponseWriter, r *http.Request, addr todomd.Address, req addProjectRequest) {
	bin := req.Todomd
	if bin == "" {
		bin = s.bin
	}
	file := addr.String()
	if strings.HasSuffix(addr.Path, "/") || path.Ext(addr.Path) == "" {
		// A directory means the TODO.md inside it, as it does locally.
		file = addr.Host + ":" + path.Join(addr.Path, "TODO.md")
	}

	if _, err := todomd.New(r.Context(), bin, file); err != nil {
		var cli *todomd.Error
		if !req.Create || !errors.As(err, &cli) || cli.NotFound() || cli.Code == 255 || cli.Code == 127 {
			s.writeError(w, err)
			return
		}
		if err := todomd.Init(r.Context(), bin, file); err != nil {
			s.writeError(w, err)
			return
		}
	}

	entry, err := s.registry.Add(file, req.Name, req.Todomd)
	if err != nil {
		if errors.Is(err, project.ErrNotConfigurable) {
			writeJSON(w, http.StatusConflict, errorResponse{err.Error()})
			return
		}
		s.writeError(w, invalid(err.Error()))
		return
	}
	writeJSON(w, http.StatusCreated, s.describe(entry))
}

// handleRemoveProject drops a project from the list. The todo file it points
// at is deliberately left alone.
func (s *Server) handleRemoveProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("project")
	err := s.registry.Remove(id)
	switch {
	case err == nil:
		s.forget(id)
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, project.ErrNotFound):
		writeJSON(w, http.StatusNotFound, errorResponse{"no such project: " + id})
	case errors.Is(err, project.ErrNotConfigurable):
		writeJSON(w, http.StatusConflict, errorResponse{err.Error()})
	default:
		s.writeError(w, err)
	}
}
