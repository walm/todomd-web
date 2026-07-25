package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/walm/todomd-web/internal/project"
)

func TestProjectsAreListed(t *testing.T) {
	srv, alpha, _ := newMultiServer(t)

	var list projectsResponse
	if code := do(t, srv, "GET", "/api/projects", "", &list); code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	if len(list.Projects) != 2 {
		t.Fatalf("projects = %+v", list.Projects)
	}
	if list.Projects[0].ID != "alpha" || list.Projects[0].File != alpha {
		t.Errorf("first project = %+v", list.Projects[0])
	}
	if !list.Projects[0].Available {
		t.Error("an existing file should be available")
	}
	if list.Configurable {
		t.Error("a list from the command line is not configurable")
	}
}

func TestProjectsAreIsolated(t *testing.T) {
	srv, _, _ := newMultiServer(t)

	var created taskResponse
	if code := do(t, srv, "POST", "/api/projects/alpha/tasks", `{"title":"only in alpha"}`, &created); code != http.StatusCreated {
		t.Fatalf("create status = %d", code)
	}
	if created.Project != "alpha" {
		t.Errorf("response names project %q", created.Project)
	}

	var board boardResponse
	do(t, srv, "GET", "/api/projects/beta/board", "", &board)
	for _, column := range board.Boards {
		if len(column.Tasks) != 0 {
			t.Fatalf("beta should be empty, got %+v", column.Tasks)
		}
	}

	// …and the task must not be reachable through the other project either.
	if code := do(t, srv, "PATCH", "/api/projects/beta/tasks/"+created.Task.ID, `{"title":"x"}`, nil); code != http.StatusNotFound {
		t.Errorf("cross-project update status = %d, want 404", code)
	}
}

func TestUnknownProject(t *testing.T) {
	srv, _, _ := newMultiServer(t)
	// A method that the path does not support is 405 whatever the project is,
	// so each case uses the method that route really takes.
	for _, tt := range []struct{ method, path, body string }{
		{"GET", "/api/projects/nope/board", ""},
		{"GET", "/api/projects/nope/changes", ""},
		{"POST", "/api/projects/nope/tasks", `{"title":"x"}`},
		{"DELETE", "/api/projects/nope/tasks/abcd", ""},
	} {
		var body errorResponse
		if code := do(t, srv, tt.method, tt.path, tt.body, &body); code != http.StatusNotFound {
			t.Errorf("%s %s: status = %d, want 404", tt.method, tt.path, code)
		}
	}
}

func TestChangeFeedsAreIndependent(t *testing.T) {
	srv, alpha, beta := newMultiServer(t)

	// Initialise both cursors.
	for _, id := range []string{"alpha", "beta"} {
		var ch changesResponse
		if code := do(t, srv, "GET", "/api/projects/"+id+"/changes", "", &ch); code != http.StatusOK {
			t.Fatalf("%s changes status = %d", id, code)
		}
		if !ch.Initialized {
			t.Fatalf("%s: first read should initialize the cursor", id)
		}
	}

	// An agent works in beta; the UI works in alpha.
	cli(t, beta, "add", "written by an agent")
	do(t, srv, "POST", "/api/projects/alpha/tasks", `{"title":"typed in the browser"}`, &taskResponse{})
	cli(t, alpha, "add", "also from an agent")

	var alphaChanges, betaChanges changesResponse
	do(t, srv, "GET", "/api/projects/alpha/changes", "", &alphaChanges)
	do(t, srv, "GET", "/api/projects/beta/changes", "", &betaChanges)

	titles := func(ch changesResponse) map[string]bool {
		out := map[string]bool{}
		for _, e := range ch.Events {
			out[e.Title] = true
		}
		return out
	}
	alphaTitles, betaTitles := titles(alphaChanges), titles(betaChanges)

	if !betaTitles["written by an agent"] {
		t.Errorf("beta's agent change missing: %+v", betaChanges.Events)
	}
	if !alphaTitles["also from an agent"] {
		t.Errorf("alpha's agent change missing: %+v", alphaChanges.Events)
	}
	// Self-suppression is per project: alpha's own edit is hidden, and it must
	// not have swallowed anything in beta either.
	if alphaTitles["typed in the browser"] {
		t.Errorf("our own change was reported as unread: %+v", alphaChanges.Events)
	}
	if betaTitles["typed in the browser"] {
		t.Errorf("alpha's change leaked into beta's feed: %+v", betaChanges.Events)
	}
}

// configServer serves a config-backed — therefore editable — project list,
// starting with one project, and returns the root the test can put more in.
func configServer(t *testing.T) (*httptest.Server, string, string) {
	t.Helper()
	requireTodomd(t)
	root := t.TempDir()
	registry, err := project.Load(filepath.Join(root, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	alpha := initFile(t, root, "alpha")
	if _, err := registry.Add(alpha, ""); err != nil {
		t.Fatal(err)
	}
	return serve(t, registry), root, alpha
}

func TestAddAndRemoveProjects(t *testing.T) {
	srv, root, alpha := configServer(t)
	beta := initFile(t, root, "beta")

	var added projectJSON
	if code := do(t, srv, "POST", "/api/projects", `{"file":"`+beta+`"}`, &added); code != http.StatusCreated {
		t.Fatalf("add status = %d", code)
	}
	if added.ID != "beta" || !added.Available {
		t.Fatalf("added = %+v", added)
	}

	// The new project is immediately usable.
	if code := do(t, srv, "POST", "/api/projects/beta/tasks", `{"title":"hello"}`, &taskResponse{}); code != http.StatusCreated {
		t.Errorf("create in the new project = %d", code)
	}

	// Removing takes it off the list and leaves the file exactly where it was.
	if code := do(t, srv, "DELETE", "/api/projects/beta", "", nil); code != http.StatusNoContent {
		t.Fatalf("remove status = %d", code)
	}
	if _, err := os.Stat(beta); err != nil {
		t.Fatalf("removing a project deleted its file: %v", err)
	}
	var list projectsResponse
	do(t, srv, "GET", "/api/projects", "", &list)
	if len(list.Projects) != 1 || list.Projects[0].File != alpha {
		t.Errorf("after removal: %+v", list.Projects)
	}
	if !list.Configurable {
		t.Error("a config-backed list should be configurable")
	}
	if code := do(t, srv, "DELETE", "/api/projects/beta", "", nil); code != http.StatusNotFound {
		t.Error("removing twice should 404")
	}
}

func TestAddCreatesAFileOnRequest(t *testing.T) {
	srv, root, _ := configServer(t)
	fresh := filepath.Join(root, "brand-new", "TODO.md")

	// Without create, a missing file is a client error…
	if code := do(t, srv, "POST", "/api/projects", `{"file":"`+fresh+`"}`, nil); code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", code)
	}
	// …with it, todomd initialises one.
	var added projectJSON
	if code := do(t, srv, "POST", "/api/projects", `{"file":"`+fresh+`","create":true,"name":"Brand New"}`, &added); code != http.StatusCreated {
		t.Fatalf("status = %d", code)
	}
	if added.ID != "brand-new" || added.Name != "Brand New" {
		t.Errorf("added = %+v", added)
	}
	var board boardResponse
	if code := do(t, srv, "GET", "/api/projects/brand-new/board", "", &board); code != http.StatusOK {
		t.Fatalf("board status = %d", code)
	}
	if len(board.Boards) != 3 {
		t.Errorf("a created file should have todomd's default boards: %+v", board.Boards)
	}
}

func TestCreatingByDirectoryName(t *testing.T) {
	srv, root, _ := configServer(t)
	dir := filepath.Join(root, "delta")

	// Naming a directory that does not exist yet must create delta/TODO.md,
	// not a file called "delta".
	var added projectJSON
	if code := do(t, srv, "POST", "/api/projects", `{"file":"`+dir+`","create":true}`, &added); code != http.StatusCreated {
		t.Fatalf("status = %d", code)
	}
	if added.File != filepath.Join(dir, "TODO.md") {
		t.Errorf("file = %q", added.File)
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		t.Errorf("%s should be a directory: %v", dir, err)
	}
}

func TestAddingADirectoryMeansItsTodoFile(t *testing.T) {
	srv, root, _ := configServer(t)
	dir := filepath.Dir(initFile(t, root, "gamma"))

	var added projectJSON
	if code := do(t, srv, "POST", "/api/projects", `{"file":"`+dir+`"}`, &added); code != http.StatusCreated {
		t.Fatalf("status = %d", code)
	}
	if added.File != filepath.Join(dir, "TODO.md") {
		t.Errorf("file = %q", added.File)
	}
}

func TestListEditsAreRefusedForAFlagList(t *testing.T) {
	srv, alpha, _ := newMultiServer(t)

	var body errorResponse
	if code := do(t, srv, "POST", "/api/projects", `{"file":"`+alpha+`"}`, &body); code != http.StatusConflict {
		t.Errorf("add status = %d, want 409 (%q)", code, body.Error)
	}
	if code := do(t, srv, "DELETE", "/api/projects/alpha", "", &body); code != http.StatusConflict {
		t.Errorf("remove status = %d, want 409 (%q)", code, body.Error)
	}
}

func TestUnavailableProjectIsListedNotFatal(t *testing.T) {
	srv, _, beta := newMultiServer(t)
	if err := os.Remove(beta); err != nil {
		t.Fatal(err)
	}

	var list projectsResponse
	if code := do(t, srv, "GET", "/api/projects", "", &list); code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	if len(list.Projects) != 2 {
		t.Fatalf("a missing file should still be listed: %+v", list.Projects)
	}
	if list.Projects[1].Available {
		t.Error("beta's file is gone; it should not be available")
	}
	// The other project keeps working.
	if code := do(t, srv, "GET", "/api/projects/alpha/board", "", &boardResponse{}); code != http.StatusOK {
		t.Errorf("alpha board status = %d", code)
	}
}
