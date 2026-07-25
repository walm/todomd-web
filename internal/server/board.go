package server

import (
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
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	version := "unknown"
	// Any project's client can answer this; they all run the same binary.
	if entries := s.registry.List(); len(entries) > 0 {
		if client, err := s.clientFor(r, entries[0]); err == nil {
			version = client.Version(r.Context())
		}
	}
	writeJSON(w, http.StatusOK, configResponse{
		Author:        s.author,
		Version:       s.ver,
		TodomdVersion: version,
		Configurable:  s.registry.Configurable(),
		ConfigFile:    s.registry.Path(),
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
	writeJSON(w, http.StatusOK, boardResponse{
		Project: entry.ID,
		File:    f.Path,
		Rev:     client.Rev(),
		Boards:  f.Boards,
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
