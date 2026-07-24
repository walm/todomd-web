package server

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/walm/todomd-web/internal/todomd"
)

type taskResponse struct {
	Task *todomd.Task `json:"task"`
	Rev  string       `json:"rev"`
}

// respondTask writes the affected task and notes that this server, not an
// agent, is responsible for the change.
func (s *Server) respondTask(w http.ResponseWriter, status int, t *todomd.Task) {
	s.markSelf(t.ID)
	writeJSON(w, status, taskResponse{Task: t, Rev: s.client.Rev()})
}

// decode reads a JSON object body, rejecting unknown fields so a typo in the
// client is an error rather than a silently ignored field.
func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return invalid("invalid request body: " + err.Error())
	}
	return nil
}

type createRequest struct {
	Board       string   `json:"board"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	Due         *string  `json:"due"`
}

func (s *Server) handleCreateTask(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	if err := decode(r, &req); err != nil {
		s.writeError(w, err)
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		s.writeError(w, invalid("title must not be empty"))
		return
	}
	t := todomd.NewTask{
		Board:       req.Board,
		Title:       req.Title,
		Description: req.Description,
		Tags:        req.Tags,
	}
	if req.Due != nil {
		t.Due = *req.Due
	}
	created, err := s.client.Add(r.Context(), t)
	if err != nil {
		s.writeError(w, err)
		return
	}
	s.respondTask(w, http.StatusCreated, created)
}

// handleUpdateTask applies a partial update. Fields absent from the body are
// left alone; `"due": null` and `"tags": []` clear them. That distinction is
// why the body is decoded key by key rather than into a struct of pointers.
func (s *Server) handleUpdateTask(w http.ResponseWriter, r *http.Request) {
	var raw map[string]json.RawMessage
	if err := decode(r, &raw); err != nil {
		s.writeError(w, err)
		return
	}
	var u todomd.Update
	for key, val := range raw {
		switch key {
		case "title":
			var v string
			if err := json.Unmarshal(val, &v); err != nil {
				s.writeError(w, invalid("title must be a string"))
				return
			}
			u.Title = &v
		case "description":
			var v string
			if err := json.Unmarshal(val, &v); err != nil {
				s.writeError(w, invalid("description must be a string"))
				return
			}
			u.Description = &v
		case "tags":
			v := []string{}
			if string(val) != "null" {
				if err := json.Unmarshal(val, &v); err != nil {
					s.writeError(w, invalid("tags must be an array of strings"))
					return
				}
			}
			u.Tags = &v
		case "due":
			v := ""
			if string(val) != "null" {
				if err := json.Unmarshal(val, &v); err != nil {
					s.writeError(w, invalid("due must be a date string or null"))
					return
				}
			}
			u.Due = &v
		default:
			s.writeError(w, invalid("unknown field "+key))
			return
		}
	}
	if u.IsEmpty() {
		s.writeError(w, invalid("nothing to update"))
		return
	}
	updated, err := s.client.Update(r.Context(), r.PathValue("id"), u)
	if err != nil {
		s.writeError(w, err)
		return
	}
	s.respondTask(w, http.StatusOK, updated)
}

type moveRequest struct {
	To  string `json:"to"`
	Pos int    `json:"pos"`
}

// handleMoveTask moves a task between boards and/or to a position. pos is
// 1-based in the target board *after* the task is removed from where it was —
// the same index a drag-and-drop drop target reports.
func (s *Server) handleMoveTask(w http.ResponseWriter, r *http.Request) {
	var req moveRequest
	if err := decode(r, &req); err != nil {
		s.writeError(w, err)
		return
	}
	if req.To == "" && req.Pos <= 0 {
		s.writeError(w, invalid("move needs a target board or a position >= 1"))
		return
	}
	moved, err := s.client.Move(r.Context(), r.PathValue("id"), req.To, req.Pos)
	if err != nil {
		s.writeError(w, err)
		return
	}
	s.respondTask(w, http.StatusOK, moved)
}

type commentRequest struct {
	Author string `json:"author"`
	Text   string `json:"text"`
}

func (s *Server) handleAddComment(w http.ResponseWriter, r *http.Request) {
	var req commentRequest
	if err := decode(r, &req); err != nil {
		s.writeError(w, err)
		return
	}
	if strings.TrimSpace(req.Text) == "" {
		s.writeError(w, invalid("comment text must not be empty"))
		return
	}
	author := strings.TrimSpace(req.Author)
	if author == "" {
		author = s.author
	}
	commented, err := s.client.Comment(r.Context(), r.PathValue("id"), author, req.Text)
	if err != nil {
		s.writeError(w, err)
		return
	}
	s.respondTask(w, http.StatusCreated, commented)
}

func (s *Server) handleDeleteTask(w http.ResponseWriter, r *http.Request) {
	deleted, err := s.client.Delete(r.Context(), r.PathValue("id"))
	if err != nil {
		s.writeError(w, err)
		return
	}
	s.markSelf(deleted.ID)
	w.WriteHeader(http.StatusNoContent)
}
