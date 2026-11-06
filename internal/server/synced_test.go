package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/walm/todomd-web/internal/project"
)

// stubTodomd is a todomd that answers the two calls the synced-images path
// makes: list (the client's start-up check) and sync status, which reports
// $SYNCED_DIR, or exits 5 (not linked) when it is empty.
const stubTodomd = `#!/bin/sh
file=""
if [ "$1" = "--file" ]; then file="$2"; shift 2; fi
case "$1 $2" in
  "list --json") printf '{"file": "%s", "boards": []}\n' "$file" ;;
  "sync status")
    if [ -n "$SYNCED_DIR" ]; then printf '{"attachments": "%s"}\n' "$SYNCED_DIR"
    else echo "todomd: not linked" >&2; exit 5; fi ;;
  *) echo '{}' ;;
esac
`

func syncedServer(t *testing.T, root string) *httptest.Server {
	t.Helper()
	stub := filepath.Join(root, "todomd")
	if err := os.WriteFile(stub, []byte(stubTodomd), 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "proj", "TODO.md")
	os.MkdirAll(filepath.Dir(file), 0o755)
	os.WriteFile(file, []byte("# TODO\n"), 0o644)
	registry, err := project.FromFiles([]string{file})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(New(Options{Registry: registry, Version: "test", Bin: stub}).Handler())
	t.Cleanup(srv.Close)
	return srv
}

func TestServesSyncedImages(t *testing.T) {
	root := t.TempDir()
	images := filepath.Join(root, "state", "todomd", "attachments", "prj_8x2k")
	att := "att_5f1c0a9be3d2a7c4b6e8"
	png := "\x89PNG\r\n\x1a\nsynced image"
	os.MkdirAll(filepath.Join(images, att), 0o755)
	os.WriteFile(filepath.Join(images, att, "shot.png"), []byte(png), 0o644)

	// A symlink in the folder pointing outside it must not be followed.
	secret := filepath.Join(root, "secret.png")
	os.WriteFile(secret, []byte("\x89PNG\r\n\x1a\nsecret"), 0o644)
	escape := "att_00000000000000000000"
	os.MkdirAll(filepath.Join(images, escape), 0o755)
	if err := os.Symlink(secret, filepath.Join(images, escape, "s.png")); err != nil {
		t.Fatal(err)
	}

	t.Setenv("SYNCED_DIR", images)
	srv := syncedServer(t, root)

	var list projectsResponse
	if code := do(t, srv, "GET", "/api/projects", "", &list); code != http.StatusOK {
		t.Fatalf("list: %d", code)
	}
	if len(list.Projects) != 1 || list.Projects[0].SyncedImages != images {
		t.Fatalf("syncedImages = %+v", list.Projects)
	}

	resp, body := fetch(t, srv, "/api/projects/proj/synced/"+att+"/shot.png")
	if resp.StatusCode != http.StatusOK || body != png {
		t.Fatalf("image: %d %q", resp.StatusCode, body)
	}
	h := resp.Header
	if h.Get("Content-Type") != "image/png" || h.Get("X-Content-Type-Options") != "nosniff" ||
		h.Get("Content-Security-Policy") == "" {
		t.Errorf("headers: %v", h)
	}

	for _, path := range []string{
		"/api/projects/proj/synced/" + escape + "/s.png",      // symlink out of the folder
		"/api/projects/proj/synced/" + att + "/missing.png",   // not there
		"/api/projects/proj/synced/att_nothex/shot.png",       // not an id
		"/api/projects/proj/synced/" + att + "/shot.svg",      // not a raster image
		"/api/projects/proj/synced/" + att + "/..%2Fshot.png", // not a name todomd writes
	} {
		if resp, _ := fetch(t, srv, path); resp.StatusCode != http.StatusNotFound {
			t.Errorf("%s: %d, want 404", path, resp.StatusCode)
		}
	}
}

func TestNoSyncedImagesWhenUnlinked(t *testing.T) {
	root := t.TempDir()
	t.Setenv("SYNCED_DIR", "")
	srv := syncedServer(t, root)
	var list projectsResponse
	do(t, srv, "GET", "/api/projects", "", &list)
	if len(list.Projects) != 1 || list.Projects[0].SyncedImages != "" {
		t.Fatalf("syncedImages = %+v", list.Projects)
	}
	if resp, _ := fetch(t, srv, "/api/projects/proj/synced/att_5f1c0a9be3d2a7c4b6e8/a.png"); resp.StatusCode != http.StatusNotFound {
		t.Errorf("status %d", resp.StatusCode)
	}
}
