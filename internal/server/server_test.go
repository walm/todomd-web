package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/walm/todomd-web/internal/todomd"
)

// newTestServer wires the API to a real todomd binary over a temp TODO.md.
// Skipped when todomd is not installed; CI installs it.
func newTestServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	if _, err := exec.LookPath(todomd.DefaultBin); err != nil {
		t.Skip("todomd not on PATH")
	}
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	file := filepath.Join(t.TempDir(), "TODO.md")
	if out, err := exec.Command(todomd.DefaultBin, "--file", file, "init").CombinedOutput(); err != nil {
		t.Fatalf("todomd init: %v: %s", err, out)
	}
	client, err := todomd.New(t.Context(), "", file)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(New(Options{Client: client, Version: "test"}).Handler())
	t.Cleanup(srv.Close)
	return srv, file
}

// do issues a request and decodes the JSON body (if any) into out.
func do(t *testing.T, srv *httptest.Server, method, path, body string, out any) int {
	t.Helper()
	var rdr io.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	}
	req, err := http.NewRequestWithContext(t.Context(), method, srv.URL+path, rdr)
	if err != nil {
		t.Fatal(err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if out != nil && len(bytes.TrimSpace(raw)) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			t.Fatalf("%s %s: decoding %q: %v", method, path, raw, err)
		}
	}
	return resp.StatusCode
}

// cli runs todomd directly, standing in for an agent working alongside the UI.
func cli(t *testing.T, file string, args ...string) {
	t.Helper()
	full := append([]string{"--file", file}, args...)
	if out, err := exec.Command(todomd.DefaultBin, full...).CombinedOutput(); err != nil {
		t.Fatalf("todomd %s: %v: %s", strings.Join(args, " "), err, out)
	}
}

func TestBoardAndConfig(t *testing.T) {
	srv, file := newTestServer(t)

	var cfg configResponse
	if code := do(t, srv, "GET", "/api/config", "", &cfg); code != http.StatusOK {
		t.Fatalf("config status = %d", code)
	}
	if cfg.File != file || cfg.Author != "user" || cfg.TodomdVersion == "" {
		t.Errorf("config = %+v", cfg)
	}

	var board boardResponse
	if code := do(t, srv, "GET", "/api/board", "", &board); code != http.StatusOK {
		t.Fatalf("board status = %d", code)
	}
	if len(board.Boards) != 3 || board.Boards[0].Name != "Backlog" || board.Rev == "" {
		t.Errorf("board = %+v", board)
	}
}

func TestTaskLifecycle(t *testing.T) {
	srv, _ := newTestServer(t)

	var created taskResponse
	code := do(t, srv, "POST", "/api/tasks",
		`{"title":"Write the UI","board":"Backlog","description":"body","tags":["ui"],"due":"2026-08-01"}`, &created)
	if code != http.StatusCreated {
		t.Fatalf("create status = %d", code)
	}
	id := created.Task.ID
	if id == "" || created.Task.Board != "Backlog" || *created.Task.Due != "2026-08-01" {
		t.Fatalf("created = %+v", created.Task)
	}

	// A partial update leaves untouched fields alone…
	var updated taskResponse
	if code := do(t, srv, "PATCH", "/api/tasks/"+id, `{"title":"Renamed"}`, &updated); code != http.StatusOK {
		t.Fatalf("update status = %d", code)
	}
	if updated.Task.Title != "Renamed" || updated.Task.Description != "body" || len(updated.Task.Tags) != 1 {
		t.Errorf("partial update changed too much: %+v", updated.Task)
	}

	// …while null/empty explicitly clear.
	if code := do(t, srv, "PATCH", "/api/tasks/"+id, `{"due":null,"tags":[]}`, &updated); code != http.StatusOK {
		t.Fatalf("clear status = %d", code)
	}
	if updated.Task.Due != nil || len(updated.Task.Tags) != 0 {
		t.Errorf("clear did not apply: %+v", updated.Task)
	}

	var commented taskResponse
	code = do(t, srv, "POST", "/api/tasks/"+id+"/comments", `{"author":"user","text":"looks good"}`, &commented)
	if code != http.StatusCreated {
		t.Fatalf("comment status = %d", code)
	}
	if len(commented.Task.Comments) != 1 || commented.Task.Comments[0].Text != "looks good" {
		t.Errorf("comments = %+v", commented.Task.Comments)
	}

	var moved taskResponse
	if code := do(t, srv, "POST", "/api/tasks/"+id+"/move", `{"to":"Done"}`, &moved); code != http.StatusOK {
		t.Fatalf("move status = %d", code)
	}
	if moved.Task.Board != "Done" {
		t.Errorf("board = %q", moved.Task.Board)
	}

	if code := do(t, srv, "DELETE", "/api/tasks/"+id, "", nil); code != http.StatusNoContent {
		t.Fatalf("delete status = %d", code)
	}
	if code := do(t, srv, "GET", "/api/board", "", &boardResponse{}); code != http.StatusOK {
		t.Fatalf("board status after delete = %d", code)
	}
}

func TestMoveReordersWithinBoard(t *testing.T) {
	srv, _ := newTestServer(t)
	ids := map[string]string{}
	for _, title := range []string{"a", "b", "c"} {
		var created taskResponse
		do(t, srv, "POST", "/api/tasks", `{"title":"`+title+`","board":"Backlog"}`, &created)
		ids[title] = created.Task.ID
	}

	// Drop "a" at index 2 of the list it leaves behind → pos 3.
	if code := do(t, srv, "POST", "/api/tasks/"+ids["a"]+"/move", `{"pos":3}`, &taskResponse{}); code != http.StatusOK {
		t.Fatalf("move status = %d", code)
	}
	var board boardResponse
	do(t, srv, "GET", "/api/board", "", &board)
	var got []string
	for _, task := range board.Boards[0].Tasks {
		got = append(got, task.Title)
	}
	if strings.Join(got, ",") != "b,c,a" {
		t.Errorf("order = %v", got)
	}
}

func TestErrorMapping(t *testing.T) {
	srv, _ := newTestServer(t)
	var created taskResponse
	do(t, srv, "POST", "/api/tasks", `{"title":"only task"}`, &created)

	tests := []struct {
		name, method, path, body string
		want                     int
	}{
		{"unknown task", "PATCH", "/api/tasks/zzzz", `{"title":"x"}`, http.StatusNotFound},
		{"empty title on create", "POST", "/api/tasks", `{"title":"  "}`, http.StatusBadRequest},
		{"empty title on update", "PATCH", "/api/tasks/" + created.Task.ID, `{"title":""}`, http.StatusBadRequest},
		{"no fields to update", "PATCH", "/api/tasks/" + created.Task.ID, `{}`, http.StatusBadRequest},
		{"unknown field", "PATCH", "/api/tasks/" + created.Task.ID, `{"colour":"red"}`, http.StatusBadRequest},
		{"malformed body", "POST", "/api/tasks", `{`, http.StatusBadRequest},
		{"bad due date", "POST", "/api/tasks", `{"title":"x","due":"tomorrow"}`, http.StatusBadRequest},
		{"move with no target", "POST", "/api/tasks/" + created.Task.ID + "/move", `{}`, http.StatusBadRequest},
		{"empty comment", "POST", "/api/tasks/" + created.Task.ID + "/comments", `{"author":"user","text":" "}`, http.StatusBadRequest},
		{"unknown endpoint", "GET", "/api/nope", "", http.StatusNotFound},
		{"wrong method", "PUT", "/api/board", "", http.StatusMethodNotAllowed},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var body errorResponse
			if code := do(t, srv, tt.method, tt.path, tt.body, &body); code != tt.want {
				t.Errorf("status = %d, want %d (body %q)", code, tt.want, body.Error)
			}
		})
	}
}

func TestAmbiguousPrefixIsConflict(t *testing.T) {
	srv, _ := newTestServer(t)
	// IDs are random, so create enough tasks to make a shared first character
	// near-certain, then address a task by that one character.
	seen := map[byte][]string{}
	var prefix byte
	for i := 0; i < 25 && prefix == 0; i++ {
		var created taskResponse
		do(t, srv, "POST", "/api/tasks", `{"title":"filler"}`, &created)
		c := created.Task.ID[0]
		seen[c] = append(seen[c], created.Task.ID)
		if len(seen[c]) > 1 {
			prefix = c
		}
	}
	if prefix == 0 {
		t.Skip("no colliding ID prefix generated")
	}
	var body errorResponse
	code := do(t, srv, "PATCH", "/api/tasks/"+string(prefix), `{"title":"x"}`, &body)
	if code != http.StatusConflict {
		t.Errorf("status = %d, want 409 (body %q)", code, body.Error)
	}
}

func TestChangesReportsAgentWorkButNotOurs(t *testing.T) {
	srv, file := newTestServer(t)

	// First read initializes the cursor.
	var ch changesResponse
	if code := do(t, srv, "GET", "/api/changes", "", &ch); code != http.StatusOK {
		t.Fatalf("changes status = %d", code)
	}
	if !ch.Initialized {
		t.Fatal("first read should initialize the cursor")
	}

	// One change from the UI, one from an agent using the CLI.
	var created taskResponse
	do(t, srv, "POST", "/api/tasks", `{"title":"typed in the browser"}`, &created)
	cli(t, file, "add", "written by an agent", "--board", "Backlog")

	if code := do(t, srv, "GET", "/api/changes", "", &ch); code != http.StatusOK {
		t.Fatalf("changes status = %d", code)
	}
	titles := map[string]bool{}
	for _, e := range ch.Events {
		titles[e.Title] = true
	}
	if !titles["written by an agent"] {
		t.Errorf("agent change missing from %+v", ch.Events)
	}
	if titles["typed in the browser"] {
		t.Errorf("our own change was reported as unread: %+v", ch.Events)
	}

	// The cursor advanced, so a second read is quiet.
	if code := do(t, srv, "GET", "/api/changes", "", &ch); code != http.StatusOK {
		t.Fatalf("changes status = %d", code)
	}
	if len(ch.Events) != 0 {
		t.Errorf("cursor did not advance: %+v", ch.Events)
	}
}

func TestReadsPickUpExternalEdits(t *testing.T) {
	srv, file := newTestServer(t)
	cli(t, file, "add", "added behind the server's back")

	var board boardResponse
	do(t, srv, "GET", "/api/board", "", &board)
	if len(board.Boards[0].Tasks) != 1 {
		t.Fatalf("external task not visible: %+v", board.Boards[0].Tasks)
	}
	before := board.Rev

	cli(t, file, "add", "and another")
	do(t, srv, "GET", "/api/board", "", &board)
	if len(board.Boards[0].Tasks) != 2 {
		t.Errorf("second external task not visible")
	}
	if board.Rev == before {
		t.Errorf("rev %q did not change after an external edit", board.Rev)
	}
}
