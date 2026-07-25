package server

import (
	"errors"
	"net/http"
	"os"
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
	// Available is false when the file has been moved or deleted since it was
	// listed. The switcher greys those out instead of the board breaking.
	Available bool `json:"available"`
}

type projectsResponse struct {
	Projects     []projectJSON `json:"projects"`
	Configurable bool          `json:"configurable"`
}

func describe(entry project.Entry) projectJSON {
	info, err := os.Stat(entry.File)
	return projectJSON{
		ID:        entry.ID,
		Name:      entry.Name,
		File:      entry.File,
		Dir:       filepath.Dir(entry.File),
		Available: err == nil && info.Mode().IsRegular(),
	}
}

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	out := projectsResponse{Projects: []projectJSON{}, Configurable: s.registry.Configurable()}
	for _, entry := range s.registry.List() {
		out.Projects = append(out.Projects, describe(entry))
	}
	writeJSON(w, http.StatusOK, out)
}

type addProjectRequest struct {
	File string `json:"file"`
	Name string `json:"name"`
	// Create runs `todomd init` when the file does not exist yet.
	Create bool `json:"create"`
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
	path := strings.TrimSpace(req.File)
	if path == "" {
		s.writeError(w, invalid("a file path is required"))
		return
	}
	if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err == nil {
			path = filepath.Join(home, path[2:])
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

	entry, err := s.registry.Add(abs, req.Name)
	if err != nil {
		if errors.Is(err, project.ErrNotConfigurable) {
			writeJSON(w, http.StatusConflict, errorResponse{err.Error()})
			return
		}
		s.writeError(w, invalid(err.Error()))
		return
	}
	writeJSON(w, http.StatusCreated, describe(entry))
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
		writeJSON(w, http.StatusOK, describe(entry))
	case errors.Is(err, project.ErrNotFound):
		writeJSON(w, http.StatusNotFound, errorResponse{"no such project: " + id})
	case errors.Is(err, project.ErrNotConfigurable):
		writeJSON(w, http.StatusConflict, errorResponse{err.Error()})
	default:
		s.writeError(w, invalid(err.Error()))
	}
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
