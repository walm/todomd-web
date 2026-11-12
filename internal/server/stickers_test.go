package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/walm/todomd-web/internal/todomd"
)

// newStickerCard adds a card through the API. It skips the test when the
// todomd on PATH predates stickers (v0.15.0): its cards come back without
// the key.
func newStickerCard(t *testing.T, srv *httptest.Server, title string) string {
	t.Helper()
	var created taskResponse
	if code := do(t, srv, "POST", "/api/projects/solo/tasks", `{"title":"`+title+`"}`, &created); code != http.StatusCreated {
		t.Fatalf("create %q: status %d", title, code)
	}
	if !created.Task.Sticker.Present {
		t.Skip("the todomd on PATH predates stickers (v0.15.0)")
	}
	return created.Task.ID
}

func TestStickerSetAndRemove(t *testing.T) {
	srv, file := newTestServer(t)
	id := newStickerCard(t, srv, "Migrate attachments")

	var got taskResponse
	if code := do(t, srv, "PATCH", "/api/projects/solo/tasks/"+id, `{"sticker":"fire"}`, &got); code != http.StatusOK {
		t.Fatalf("set status = %d", code)
	}
	if got.Task.Sticker != (todomd.Sticker{Name: "fire", Present: true}) {
		t.Fatalf("sticker on the reply = %+v", got.Task.Sticker)
	}
	// Written the way todomd writes it, and read back the same by todomd.
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "<!-- sticker: fire -->\n") {
		t.Fatalf("TODO.md after setting:\n%s", raw)
	}
	out, err := exec.Command(todomd.DefaultBin, "--file", file, "show", id).CombinedOutput()
	if err != nil || !strings.Contains(string(out), "fire") {
		t.Fatalf("todomd show: %v\n%s", err, out)
	}

	// A ribbon replaces it; the other fields stay as they were.
	if code := do(t, srv, "PATCH", "/api/projects/solo/tasks/"+id, `{"sticker":"red","priority":"high"}`, &got); code != http.StatusOK {
		t.Fatalf("ribbon status = %d", code)
	}
	if got.Task.Sticker.Name != "red" || got.Task.Priority != "high" || got.Task.Title != "Migrate attachments" {
		t.Errorf("after the ribbon: %+v", got.Task)
	}

	// null removes it, and leaves no line behind.
	if code := do(t, srv, "PATCH", "/api/projects/solo/tasks/"+id, `{"sticker":null}`, &got); code != http.StatusOK {
		t.Fatalf("remove status = %d", code)
	}
	if got.Task.Sticker != (todomd.Sticker{Present: true}) {
		t.Errorf("sticker after removing = %+v", got.Task.Sticker)
	}
	if after, _ := os.ReadFile(file); strings.Contains(string(after), "sticker") {
		t.Errorf("a sticker line was left behind:\n%s", after)
	}
}

func TestStickerSetByTheCLI(t *testing.T) {
	srv, file := newTestServer(t)
	id := newStickerCard(t, srv, "Ship it")
	cli(t, file, "sticker", id, "🚀")
	var board boardResponse
	do(t, srv, "GET", "/api/projects/solo/board", "", &board)
	if s := board.Boards[0].Tasks[0].Sticker; s.Name != "ship" {
		t.Errorf("the CLI's sticker on the board = %+v", s)
	}
}

func TestStickerRefused(t *testing.T) {
	srv, file := newTestServer(t)
	id := newStickerCard(t, srv, "A")
	before, _ := os.ReadFile(file)
	for _, tt := range []struct {
		name, body string
	}{
		{"unknown name", `{"sticker":"unicorn"}`},
		{"a flag", `{"sticker":"--help"}`},
		{"an emoji", `{"sticker":"🔥"}`},
		{"not a string", `{"sticker":3}`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var e errorResponse
			if code := do(t, srv, "PATCH", "/api/projects/solo/tasks/"+id, tt.body, &e); code != http.StatusBadRequest {
				t.Errorf("status = %d (%s), want 400", code, e.Error)
			}
		})
	}
	if after, _ := os.ReadFile(file); string(after) != string(before) {
		t.Errorf("a refused sticker changed the file:\n%s", after)
	}
}
