// Package web embeds the built single-page app and serves it.
//
// dist/ is checked in so that `go build` and `go install` produce a working
// binary without Node installed; `mise run build-web` regenerates it.
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed all:dist
var dist embed.FS

// Assets returns a handler for the SPA: real files are served from the
// bundle, everything else falls back to index.html so client-side routes
// (e.g. /t/3f2a) survive a reload.
func Assets() http.Handler {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err) // the embed directive guarantees dist exists
	}
	return &spa{fsys: sub, files: http.FileServerFS(sub)}
}

type spa struct {
	fsys  fs.FS
	files http.Handler
}

func (s *spa) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name != "" {
		if f, err := s.fsys.Open(name); err == nil {
			f.Close()
			// Vite fingerprints these filenames, so they can be cached hard.
			if strings.HasPrefix(name, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			s.files.ServeHTTP(w, r)
			return
		}
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFileFS(w, r, s.fsys, "index.html")
}
