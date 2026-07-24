package server

import (
	"errors"
	"net/http"

	"github.com/walm/todomd-web/internal/todomd"
)

// badRequest is a client mistake detected before todomd is ever invoked.
type badRequest struct{ msg string }

func (e *badRequest) Error() string { return e.msg }

func invalid(msg string) error { return &badRequest{msg} }

// writeError maps an error to a status code: todomd's exit codes carry the
// meaning (2 no such task, 3 ambiguous prefix, 1 anything it rejected —
// validation, a missing file, a parse error), so they translate directly.
func (s *Server) writeError(w http.ResponseWriter, err error) {
	var bad *badRequest
	var cli *todomd.Error
	switch {
	case errors.As(err, &bad):
		writeJSON(w, http.StatusBadRequest, errorResponse{err.Error()})
	case errors.As(err, &cli):
		switch {
		case cli.NotFound():
			writeJSON(w, http.StatusNotFound, errorResponse{err.Error()})
		case cli.Ambiguous():
			writeJSON(w, http.StatusConflict, errorResponse{err.Error()})
		default:
			writeJSON(w, http.StatusBadRequest, errorResponse{err.Error()})
		}
	default:
		s.log.Error("request failed", "err", err)
		writeJSON(w, http.StatusInternalServerError, errorResponse{err.Error()})
	}
}
