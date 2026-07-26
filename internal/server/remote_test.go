package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/walm/todomd-web/internal/project"
)

// fakeSSHOnPath installs an "ssh" that runs the command it is given on this
// machine instead of another one. That is enough to exercise the whole chain
// — argv, quoting, error mapping, the API — against a real todomd and a real
// file, without a host to connect to.
func fakeSSHOnPath(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	// $1..$n are ssh's options and destination; the last argument is the
	// command line for the remote shell, which is exactly what `sh -c` takes.
	script := `#!/bin/sh
for last; do :; done
exec sh -c "$last"
`
	if err := os.WriteFile(filepath.Join(dir, "ssh"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func remoteServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	requireTodomd(t)
	fakeSSHOnPath(t)
	file := initFile(t, t.TempDir(), "app")
	registry, err := project.FromFiles([]string{"deploy@web1:" + file})
	if err != nil {
		t.Fatal(err)
	}
	return serve(t, registry), file
}

func TestRemoteProjectBehavesLikeALocalOne(t *testing.T) {
	srv, file := remoteServer(t)

	var list projectsResponse
	if code := do(t, srv, "GET", "/api/projects", "", &list); code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	if len(list.Projects) != 1 || list.Projects[0].Host != "deploy@web1" {
		t.Fatalf("projects = %+v", list.Projects)
	}
	id := list.Projects[0].ID
	if !list.Projects[0].Available {
		t.Error("a remote project is taken on trust rather than stat'd")
	}

	// The full lifecycle, over the "ssh" hop.
	var created taskResponse
	if code := do(t, srv, "POST", "/api/projects/"+id+"/tasks",
		`{"title":"Deploy the fix","board":"Backlog"}`, &created); code != http.StatusCreated {
		t.Fatalf("create status = %d", code)
	}

	// Text that would break a shell has to survive the remote quoting: this is
	// the failure mode the whole design worries about.
	tricky := "it's $HOME `whoami`\n## not a board\nrm -rf /"
	var commented taskResponse
	if code := do(t, srv, "POST", "/api/projects/"+id+"/tasks/"+created.Task.ID+"/comments",
		mustJSON(t, map[string]string{"author": "user", "text": tricky}), &commented); code != http.StatusCreated {
		t.Fatalf("comment status = %d", code)
	}
	if len(commented.Task.Comments) != 1 || commented.Task.Comments[0].Text != tricky {
		t.Errorf("comment did not survive the hop: %+v", commented.Task.Comments)
	}

	// …and it really is in the file on "the other machine".
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "Deploy the fix") || !strings.Contains(string(raw), "`whoami`") {
		t.Errorf("file does not hold the change:\n%s", raw)
	}

	var board boardResponse
	do(t, srv, "GET", "/api/projects/"+id+"/board", "", &board)
	if len(board.Boards[0].Tasks) != 1 {
		t.Errorf("board = %+v", board.Boards[0].Tasks)
	}
	if board.Rev != "" {
		t.Errorf("a remote board has no cheap revision, got %q", board.Rev)
	}
}

func TestRemoteAddVerifiesBeforeListing(t *testing.T) {
	requireTodomd(t)
	fakeSSHOnPath(t)
	root := t.TempDir()
	registry, err := project.Load(filepath.Join(root, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	srv := serve(t, registry)

	// Nothing there: the add fails now, with todomd's own message, rather than
	// leaving a project that only breaks when opened.
	missing := filepath.Join(root, "nope", "TODO.md")
	var body errorResponse
	if code := do(t, srv, "POST", "/api/projects", `{"file":"web1:`+missing+`"}`, &body); code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%q)", code, body.Error)
	}
	var list projectsResponse
	do(t, srv, "GET", "/api/projects", "", &list)
	if len(list.Projects) != 0 {
		t.Errorf("a failed add still listed something: %+v", list.Projects)
	}

	// With create, todomd initialises it on "the remote host" first.
	var added projectJSON
	if code := do(t, srv, "POST", "/api/projects",
		`{"file":"web1:`+missing+`","create":true}`, &added); code != http.StatusCreated {
		t.Fatalf("create status = %d", code)
	}
	if added.Host != "web1" {
		t.Errorf("added = %+v", added)
	}
	if _, err := os.Stat(missing); err != nil {
		t.Errorf("the file was not created: %v", err)
	}
}

func TestUnreachableHostIsReportedAsSuch(t *testing.T) {
	requireTodomd(t)
	dir := t.TempDir()
	// An "ssh" that always fails the way an unreachable host does.
	script := "#!/bin/sh\necho 'ssh: connect to host web1 port 22: Operation timed out' >&2\nexit 255\n"
	if err := os.WriteFile(filepath.Join(dir, "ssh"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))

	registry, err := project.FromFiles([]string{"web1:/srv/app/TODO.md"})
	if err != nil {
		t.Fatal(err)
	}
	srv := serve(t, registry)

	var body errorResponse
	code := do(t, srv, "GET", "/api/projects/web1-app/board", "", &body)
	if code != http.StatusBadRequest {
		t.Fatalf("status = %d (%q)", code, body.Error)
	}
	if !strings.Contains(body.Error, "cannot reach web1") {
		t.Errorf("error should name the machine: %q", body.Error)
	}
	// The board is broken, but the project list still works, so the switcher
	// can still take you somewhere else.
	var list projectsResponse
	if code := do(t, srv, "GET", "/api/projects", "", &list); code != http.StatusOK {
		t.Errorf("projects status = %d", code)
	}
}
