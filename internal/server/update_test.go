package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/walm/todomd-web/internal/project"
	"github.com/walm/todomd-web/internal/selfupdate"
)

// updateServer serves one project with a pinned version string.
func updateServer(t *testing.T, version string) *httptest.Server {
	t.Helper()
	requireTodomd(t)
	// requireTodomd points XDG_STATE_HOME at a temp dir, so the update cache
	// is this test's alone.
	registry, err := project.FromFiles([]string{initFile(t, t.TempDir(), "solo")})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(New(Options{Registry: registry, Version: version}).Handler())
	t.Cleanup(srv.Close)
	return srv
}

func TestUpdateReportsFromTheCache(t *testing.T) {
	srv := updateServer(t, "v0.1.0")
	if err := selfupdate.SaveCache("v9.9.9", time.Now()); err != nil {
		t.Fatal(err)
	}

	var out updateResponse
	if code := do(t, srv, "GET", "/api/update", "", &out); code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	if !out.Supported || !out.Available {
		t.Fatalf("update = %+v", out)
	}
	if out.Latest != "v9.9.9" || out.Current != "v0.1.0" {
		t.Errorf("versions = %+v", out)
	}
	if out.ReleaseURL != "https://github.com/walm/todomd-web/releases/tag/v9.9.9" {
		t.Errorf("releaseUrl = %q", out.ReleaseURL)
	}
}

func TestUpdateSaysNothingWhenAlreadyCurrent(t *testing.T) {
	srv := updateServer(t, "v9.9.9")
	if err := selfupdate.SaveCache("v9.9.9", time.Now()); err != nil {
		t.Fatal(err)
	}
	var out updateResponse
	do(t, srv, "GET", "/api/update", "", &out)
	if out.Available {
		t.Errorf("running the latest release should not offer an upgrade: %+v", out)
	}
}

func TestUpdateIsUnsupportedForDevBuilds(t *testing.T) {
	// A source build has no release to compare against, so the UI must not
	// nag — and the upgrade endpoint must refuse to swap it for a published
	// binary.
	srv := updateServer(t, "dev")
	if err := selfupdate.SaveCache("v9.9.9", time.Now()); err != nil {
		t.Fatal(err)
	}

	var out updateResponse
	do(t, srv, "GET", "/api/update", "", &out)
	if out.Supported || out.Available || out.Latest != "" {
		t.Errorf("dev build = %+v", out)
	}

	var body errorResponse
	if code := do(t, srv, "POST", "/api/update", "", &body); code != http.StatusConflict {
		t.Errorf("upgrade status = %d, want 409 (%q)", code, body.Error)
	}
}

func TestUpdateCheckingCanBeSwitchedOff(t *testing.T) {
	t.Setenv(selfupdate.NoCheckEnv, "1")
	srv := updateServer(t, "v0.1.0")
	if err := selfupdate.SaveCache("v9.9.9", time.Now()); err != nil {
		t.Fatal(err)
	}
	var out updateResponse
	do(t, srv, "GET", "/api/update", "", &out)
	if out.Supported || out.Available {
		t.Errorf("%s should silence the banner entirely: %+v", selfupdate.NoCheckEnv, out)
	}
}
