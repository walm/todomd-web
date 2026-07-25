package server

import (
	"context"
	"net/http"
	"os"
	"time"

	"github.com/walm/todomd-web/internal/selfupdate"
)

type updateResponse struct {
	Current   string `json:"current"`
	Latest    string `json:"latest,omitempty"`
	Available bool   `json:"available"`
	// ReleaseURL is where the changelog for `latest` lives.
	ReleaseURL string `json:"releaseUrl,omitempty"`
	// Supported is false for a development build or when checking is switched
	// off; the UI then never mentions updates at all.
	Supported bool   `json:"supported"`
	CheckedAt string `json:"checkedAt,omitempty"`
}

// handleUpdate reports whether a newer release exists. It answers from the
// cached check and kicks off a refresh in the background when that has gone
// stale — a board left open for a week should notice a release, but no request
// should ever wait on GitHub.
func (s *Server) handleUpdate(w http.ResponseWriter, r *http.Request) {
	current := s.ver
	out := updateResponse{Current: current, Supported: !selfupdate.Disabled(current)}
	if !out.Supported {
		writeJSON(w, http.StatusOK, out)
		return
	}

	latest, checkedAt, ok := selfupdate.LoadCache()
	if ok {
		out.Latest = latest
		out.Available = selfupdate.Newer(current, latest)
		out.ReleaseURL = selfupdate.ReleaseURL(latest)
		out.CheckedAt = checkedAt.UTC().Format(time.RFC3339)
	}
	if selfupdate.Stale(time.Now()) {
		// Detached from the request: the answer lands in the cache for the
		// next poll, which the UI makes on its own schedule.
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			selfupdate.RefreshCache(ctx, current, time.Now())
		}()
	}
	writeJSON(w, http.StatusOK, out)
}

type upgradeResponse struct {
	Upgraded   bool   `json:"upgraded"`
	Version    string `json:"version"`
	Restarting bool   `json:"restarting"`
}

// handleUpgrade installs the latest release and restarts into it. The reply is
// sent before the restart so the browser knows what happened; it then waits
// for the server to come back and reloads.
//
// Failures are reported and change nothing: the binary on disk is replaced
// only after its checksum matches and it has proved it runs.
func (s *Server) handleUpgrade(w http.ResponseWriter, r *http.Request) {
	current := s.ver
	if selfupdate.Disabled(current) {
		writeJSON(w, http.StatusConflict, errorResponse{
			"this is a development build, not a release; upgrade it with git"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	client := selfupdate.NewClient()
	latest, err := client.Latest(ctx)
	if err != nil {
		s.writeError(w, err)
		return
	}
	_ = selfupdate.SaveCache(latest, time.Now())
	if !selfupdate.Newer(current, latest) {
		writeJSON(w, http.StatusOK, upgradeResponse{Version: current})
		return
	}

	exe, err := os.Executable()
	if err != nil {
		s.writeError(w, err)
		return
	}
	bin, err := client.Download(ctx, latest)
	if err != nil {
		s.writeError(w, err)
		return
	}
	if err := selfupdate.Install(bin, exe); err != nil {
		s.writeError(w, err)
		return
	}

	s.log.Info("upgraded", "from", current, "to", latest, "path", exe)
	writeJSON(w, http.StatusOK, upgradeResponse{
		Upgraded: true, Version: latest, Restarting: s.restart != nil,
	})
	if s.restart == nil {
		return
	}
	// Let the response reach the browser before this process is replaced.
	go func() {
		time.Sleep(300 * time.Millisecond)
		if err := s.restart(); err != nil {
			s.log.Error("restart failed; run todomd-web again to pick up the new version", "err", err)
		}
	}()
}
