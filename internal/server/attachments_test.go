package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/walm/todomd-web/internal/attach"
	"github.com/walm/todomd-web/internal/project"
)

type upload struct{ name, body string }

// attachFiles posts files as one multipart upload to a task.
func attachFiles(t *testing.T, srv *httptest.Server, projectID, taskID string, files ...upload) (int, attachmentsResponse, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for _, f := range files {
		part, err := mw.CreateFormFile("file", f.name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.WriteString(part, f.body)
	}
	_ = mw.Close()

	url := srv.URL + "/api/projects/" + projectID + "/tasks/" + taskID + "/attachments"
	req, err := http.NewRequestWithContext(t.Context(), "POST", url, &buf)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out attachmentsResponse
	if resp.StatusCode == http.StatusCreated {
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatalf("decoding %q: %v", raw, err)
		}
	}
	return resp.StatusCode, out, string(raw)
}

func fetch(t *testing.T, srv *httptest.Server, path string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), "GET", srv.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp, string(raw)
}

func createTask(t *testing.T, srv *httptest.Server, projectID, title string) string {
	t.Helper()
	var created taskResponse
	if code := do(t, srv, "POST", "/api/projects/"+projectID+"/tasks", `{"title":"`+title+`"}`, &created); code != http.StatusCreated {
		t.Fatalf("create status = %d", code)
	}
	return created.Task.ID
}

func gone(t *testing.T, path string) bool {
	t.Helper()
	_, err := os.Stat(path)
	return errors.Is(err, os.ErrNotExist)
}

func TestAttachmentRoundTrip(t *testing.T) {
	srv, _ := newTestServer(t)
	id := createTask(t, srv, "solo", "Header overlaps")

	var list projectsResponse
	do(t, srv, "GET", "/api/projects", "", &list)
	root := list.Projects[0].Attachments
	if root == "" {
		t.Fatal("a local project should say where its attachments live")
	}

	code, out, raw := attachFiles(t, srv, "solo", id,
		upload{"header ios.png", "PNGDATA"},
		upload{"page.html", "<script>alert(1)</script>"},
	)
	if code != http.StatusCreated || len(out.Attachments) != 2 {
		t.Fatalf("upload = %d %s", code, raw)
	}
	shot := out.Attachments[0]
	if !strings.HasPrefix(shot.Path, root+string(filepath.Separator)) {
		t.Errorf("path %q is not under the project's root %q", shot.Path, root)
	}
	if shot.Markdown != "![header ios.png](<"+shot.Path+">)" {
		t.Errorf("markdown = %s", shot.Markdown)
	}
	if data, err := os.ReadFile(shot.Path); err != nil || string(data) != "PNGDATA" {
		t.Errorf("on disk: %q, %v", data, err)
	}

	// The link written into the file resolves back through the API.
	resp, body := fetch(t, srv, "/api/projects/solo/attachments/"+id+"/header%20ios.png")
	if resp.StatusCode != http.StatusOK || body != "PNGDATA" {
		t.Fatalf("serve = %d %q", resp.StatusCode, body)
	}
	h := resp.Header
	if h.Get("Content-Type") != "image/png" || h.Get("X-Content-Type-Options") != "nosniff" ||
		!strings.HasPrefix(h.Get("Content-Disposition"), "inline") ||
		!strings.Contains(h.Get("Content-Security-Policy"), "sandbox") {
		t.Errorf("image headers = %v", h)
	}

	// HTML is never rendered by the browser, whatever it contains.
	resp, _ = fetch(t, srv, "/api/projects/solo/attachments/"+id+"/page.html")
	if !strings.HasPrefix(resp.Header.Get("Content-Disposition"), "attachment") {
		t.Errorf("html disposition = %q", resp.Header.Get("Content-Disposition"))
	}

	for _, path := range []string{
		"/api/projects/solo/attachments/" + id + "/..%2F..%2F..%2Fetc%2Fpasswd",
		"/api/projects/solo/attachments/..%2F" + id + "/page.html",
		"/api/projects/solo/attachments/" + id + "/missing.png",
	} {
		if resp, _ := fetch(t, srv, path); resp.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", path, resp.StatusCode)
		}
	}

	// Deleting the task takes its attachments with it.
	if code := do(t, srv, "DELETE", "/api/projects/solo/tasks/"+id, "", nil); code != http.StatusNoContent {
		t.Fatalf("delete status = %d", code)
	}
	if !gone(t, filepath.Dir(shot.Path)) {
		t.Error("the task's attachments should go with it")
	}
}

func TestAttachmentUploadRefusals(t *testing.T) {
	requireTodomd(t)
	file := initFile(t, t.TempDir(), "solo")
	registry, err := project.FromFiles([]string{file})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(New(Options{Registry: registry, MaxAttachment: 8}).Handler())
	t.Cleanup(srv.Close)
	id := createTask(t, srv, "solo", "Tiny")

	if code, _, raw := attachFiles(t, srv, "solo", "zzzz", upload{"a.txt", "x"}); code != http.StatusNotFound {
		t.Errorf("upload to a missing task = %d %s", code, raw)
	}

	// All or nothing: the small file that came first does not stay behind.
	code, _, raw := attachFiles(t, srv, "solo", id, upload{"ok.txt", "small"}, upload{"big.txt", "far too large"})
	if code != http.StatusRequestEntityTooLarge || !strings.Contains(raw, "8 bytes") {
		t.Errorf("oversize upload = %d %s", code, raw)
	}
	root, _ := attach.DefaultRoot()
	if dir := filepath.Join(attach.New(root).Root(file), id); !gone(t, filepath.Join(dir, "ok.txt")) {
		t.Error("a failed upload must not leave part of itself behind")
	}

	if code, _, _ := attachFiles(t, srv, "solo", id); code != http.StatusBadRequest {
		t.Errorf("empty upload = %d", code)
	}
	if code := do(t, srv, "POST", "/api/projects/solo/tasks/"+id+"/attachments", `{"x":1}`, nil); code != http.StatusBadRequest {
		t.Errorf("non-multipart upload = %d", code)
	}
}

func TestRemoteProjectsCannotAttach(t *testing.T) {
	srv, _ := remoteServer(t)
	var list projectsResponse
	do(t, srv, "GET", "/api/projects", "", &list)
	p := list.Projects[0]
	if p.Attachments != "" {
		t.Errorf("a remote project must not advertise an attachment root: %q", p.Attachments)
	}
	id := createTask(t, srv, p.ID, "Over there")
	code, _, raw := attachFiles(t, srv, p.ID, id, upload{"a.png", "x"})
	if code != http.StatusBadRequest || !strings.Contains(raw, "ssh") {
		t.Errorf("remote upload = %d %s", code, raw)
	}
}

func TestAttachmentsFollowDeletionsFromElsewhere(t *testing.T) {
	srv, file := newTestServer(t)
	byAgent := createTask(t, srv, "solo", "Deleted by an agent")
	_, out, _ := attachFiles(t, srv, "solo", byAgent, upload{"a.txt", "x"})
	dir := filepath.Dir(out.Attachments[0].Path)

	do(t, srv, "GET", "/api/projects/solo/changes", "", nil) // prime the cursor
	cli(t, file, "delete", byAgent, "--yes")
	do(t, srv, "GET", "/api/projects/solo/changes", "", nil)
	if !gone(t, dir) {
		t.Error("a task_deleted event should remove the task's attachments")
	}
}

func TestBoardReadSweepsOrphans(t *testing.T) {
	srv, file := newTestServer(t)
	live := createTask(t, srv, "solo", "Still here")
	_, out, _ := attachFiles(t, srv, "solo", live, upload{"keep.txt", "x"})

	// A task deleted while nobody was watching the change feed.
	root, _ := attach.DefaultRoot()
	store := attach.New(root)
	if _, err := store.Save(file, "dead", "old.txt", strings.NewReader("x"), 10); err != nil {
		t.Fatal(err)
	}
	orphan := filepath.Join(store.Root(file), "dead")
	old := time.Now().Add(-2 * attach.SweepGrace)
	for _, p := range []string{orphan, filepath.Dir(out.Attachments[0].Path)} {
		if err := os.Chtimes(p, old, old); err != nil {
			t.Fatal(err)
		}
	}

	do(t, srv, "GET", "/api/projects/solo/board", "", nil)
	if !gone(t, orphan) {
		t.Error("a board read should sweep attachments of tasks no longer in the file")
	}
	if gone(t, out.Attachments[0].Path) {
		t.Error("a live task's attachments must survive the sweep")
	}
}

func TestDeletingABoardRemovesItsTasksAttachments(t *testing.T) {
	srv, _ := newTestServer(t)
	requireBoardDelete(t)
	var created taskResponse
	do(t, srv, "POST", "/api/projects/solo/tasks", `{"title":"Doomed","board":"Done"}`, &created)
	_, out, _ := attachFiles(t, srv, "solo", created.Task.ID, upload{"a.txt", "x"})

	if code := do(t, srv, "DELETE", "/api/projects/solo/boards/Done?force=true", "", nil); code != http.StatusOK {
		t.Fatalf("delete board = %d", code)
	}
	if !gone(t, filepath.Dir(out.Attachments[0].Path)) {
		t.Error("a deleted board's tasks should take their attachments with them")
	}
}
