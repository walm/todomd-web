package server

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/walm/todomd-web/internal/project"
	"github.com/walm/todomd-web/internal/todomd"
)

// A card id or unique prefix, and a link kind as todomd reads it ("blocked
// by", "Blocked-By"). Both become arguments to todomd, so neither may look
// like a flag; todomd itself decides whether the kind is one it knows and
// whether the card exists.
var (
	linkIDRe   = regexp.MustCompile(`^[0-9a-z]{1,4}$`)
	linkKindRe = regexp.MustCompile(`^[A-Za-z]+(?:[ -][A-Za-z]+)?$`)
)

type linkRequest struct {
	Kind string `json:"kind"`
	To   string `json:"to"`
}

// handleAddLink stores "{id} kind to" on the card {id}, the one it was made
// from, the way `todomd links add` does; the other card shows it inverted.
// The reply is that card, with its links both ways.
func (s *Server) handleAddLink(w http.ResponseWriter, r *http.Request, entry project.Entry, client *todomd.Client) {
	var req linkRequest
	if err := decode(r, &req); err != nil {
		s.writeError(w, err)
		return
	}
	id := r.PathValue("id")
	req.Kind = strings.TrimSpace(req.Kind)
	switch {
	case !linkIDRe.MatchString(id):
		s.writeError(w, invalid("invalid card id "+strconv.Quote(id)))
		return
	case !linkIDRe.MatchString(req.To):
		s.writeError(w, invalid("to must be a card id"))
		return
	case !linkKindRe.MatchString(req.Kind):
		s.writeError(w, invalid("kind must be a link kind, e.g. blocks or split from"))
		return
	}
	linked, err := client.AddLink(r.Context(), id, req.Kind, req.To)
	if err != nil {
		s.writeError(w, err)
		return
	}
	s.respondTask(w, http.StatusOK, entry, client, linked)
}

type unlinkResponse struct {
	Project string               `json:"project"`
	Removed []todomd.RemovedLink `json:"removed"`
	Rev     string               `json:"rev"`
}

// handleRemoveLink removes the links between {id} and {to} from whichever
// card stores them; ?kind= narrows it to one relation, read from {id}'s
// side. {to} may be a card that is no longer on the board. 404 when there is
// no such link.
func (s *Server) handleRemoveLink(w http.ResponseWriter, r *http.Request, entry project.Entry, client *todomd.Client) {
	id, to := r.PathValue("id"), r.PathValue("to")
	kind := strings.TrimSpace(r.URL.Query().Get("kind"))
	switch {
	case !linkIDRe.MatchString(id):
		s.writeError(w, invalid("invalid card id "+strconv.Quote(id)))
		return
	case !linkIDRe.MatchString(to):
		s.writeError(w, invalid("invalid card id "+strconv.Quote(to)))
		return
	case kind != "" && !linkKindRe.MatchString(kind):
		s.writeError(w, invalid("kind must be a link kind, e.g. blocks or split from"))
		return
	}
	removed, err := client.RemoveLinks(r.Context(), id, to, kind)
	if err != nil {
		s.writeError(w, err)
		return
	}
	// The line may have been on the other card: that card changed, not
	// this one, and it is this server's doing either way.
	for _, l := range removed {
		s.markSelf(entry.ID, l.StoredOn)
	}
	if removed == nil {
		removed = []todomd.RemovedLink{}
	}
	writeJSON(w, http.StatusOK, unlinkResponse{Project: entry.ID, Removed: removed, Rev: client.Rev()})
}
