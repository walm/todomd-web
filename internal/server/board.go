package server

import (
	"net/http"

	"github.com/walm/todomd-web/internal/todomd"
)

type configResponse struct {
	File          string `json:"file"`
	Author        string `json:"author"`
	Version       string `json:"version"`
	TodomdVersion string `json:"todomdVersion"`
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, configResponse{
		File:          s.client.File,
		Author:        s.author,
		Version:       s.ver,
		TodomdVersion: s.client.Version(r.Context()),
	})
}

type boardResponse struct {
	File   string         `json:"file"`
	Rev    string         `json:"rev"`
	Boards []todomd.Board `json:"boards"`
}

func (s *Server) handleBoard(w http.ResponseWriter, r *http.Request) {
	f, err := s.client.List(r.Context())
	if err != nil {
		s.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, boardResponse{File: f.Path, Rev: s.client.Rev(), Boards: f.Boards})
}

type changesResponse struct {
	Rev         string         `json:"rev"`
	Initialized bool           `json:"initialized"`
	Events      []todomd.Event `json:"events"`
}

// handleChanges reports what changed since this server last looked, dropping
// the events it caused itself. Reading advances todomd's cursor, so each
// event is delivered once.
func (s *Server) handleChanges(w http.ResponseWriter, r *http.Request) {
	ch, err := s.client.Changes(r.Context(), s.cursor, false)
	if err != nil {
		s.writeError(w, err)
		return
	}
	own := s.takeSelf()
	events := []todomd.Event{}
	for _, e := range ch.Events {
		if own[e.TaskID] {
			continue
		}
		events = append(events, e)
	}
	writeJSON(w, http.StatusOK, changesResponse{
		Rev:         s.client.Rev(),
		Initialized: ch.Initialized,
		Events:      events,
	})
}
