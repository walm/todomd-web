package todomd

import (
	"errors"
	"os/exec"
	"path/filepath"
	"slices"
	"testing"
)

// newRealClient sets up a temp TODO.md driven by the actual todomd binary.
// Skipped when todomd is not installed; CI installs it.
func newRealClient(t *testing.T) *Client {
	t.Helper()
	if _, err := exec.LookPath(DefaultBin); err != nil {
		t.Skip("todomd not on PATH")
	}
	// Keep locks and change cursors out of the developer's real state dir.
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	file := filepath.Join(t.TempDir(), "TODO.md")
	if out, err := exec.Command(DefaultBin, "--file", file, "init").CombinedOutput(); err != nil {
		t.Fatalf("todomd init: %v: %s", err, out)
	}
	c, err := New(t.Context(), "", file)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestIntegrationTaskLifecycle(t *testing.T) {
	c := newRealClient(t)
	ctx := t.Context()

	created, err := c.Add(ctx, NewTask{
		Title: "Fix the parser", Board: "Backlog", Description: "Some **markdown**",
		Tags: []string{"core", "parser"}, Due: "2026-08-01",
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || created.Board != "Backlog" {
		t.Fatalf("unexpected created task: %+v", created)
	}

	got, err := c.Show(ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(got.Tags, []string{"core", "parser"}) || got.Description != "Some **markdown**" {
		t.Errorf("round trip lost fields: %+v", got)
	}

	updated, err := c.Update(ctx, created.ID, Update{Title: str("Renamed"), Due: str("")})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Title != "Renamed" || updated.Due != nil {
		t.Errorf("update not applied: %+v", updated)
	}

	moved, err := c.Move(ctx, created.ID, "In Progress", 0)
	if err != nil {
		t.Fatal(err)
	}
	if moved.Board != "In Progress" {
		t.Errorf("board = %q", moved.Board)
	}

	// Text that would break a shell, and structural markdown that the file
	// format has to escape, must survive verbatim.
	tricky := "line one $HOME `backtick`\n## not a board\nend"
	commented, err := c.Comment(ctx, created.ID, "user", tricky)
	if err != nil {
		t.Fatal(err)
	}
	if len(commented.Comments) != 1 || commented.Comments[0].Text != tricky {
		t.Errorf("comment round trip: %+v", commented.Comments)
	}

	file, err := c.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(file.Boards) != 3 || file.Path != c.File {
		t.Errorf("list = %+v", file)
	}

	if _, err := c.Delete(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	_, err = c.Show(ctx, created.ID)
	var e *Error
	if !errors.As(err, &e) || !e.NotFound() {
		t.Errorf("after delete, show returned %v", err)
	}
}

func TestIntegrationMovePositionIsPostRemovalIndex(t *testing.T) {
	c := newRealClient(t)
	ctx := t.Context()
	var ids []string
	for _, title := range []string{"a", "b", "c", "d"} {
		task, err := c.Add(ctx, NewTask{Title: title, Board: "Backlog"})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, task.ID)
	}

	titles := func() []string {
		file, err := c.List(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var out []string
		for _, task := range file.Boards[0].Tasks {
			out = append(out, task.Title)
		}
		return out
	}

	// Dragging "a" (index 0) down to index 2 of the post-removal list, which
	// is what dnd-kit reports, means --pos 3.
	if _, err := c.Move(ctx, ids[0], "", 3); err != nil {
		t.Fatal(err)
	}
	if got := titles(); !slices.Equal(got, []string{"b", "c", "a", "d"}) {
		t.Errorf("after moving a down: %v", got)
	}
	// And back up to the front.
	if _, err := c.Move(ctx, ids[0], "", 1); err != nil {
		t.Fatal(err)
	}
	if got := titles(); !slices.Equal(got, []string{"a", "b", "c", "d"}) {
		t.Errorf("after moving a up: %v", got)
	}
}

func TestIntegrationChangesFeed(t *testing.T) {
	c := newRealClient(t)
	ctx := t.Context()

	first, err := c.Changes(ctx, "web", false)
	if err != nil {
		t.Fatal(err)
	}
	if !first.Initialized {
		t.Fatal("first read should initialize the cursor")
	}

	added, err := c.Add(ctx, NewTask{Title: "From an agent"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Comment(ctx, added.ID, "ai", "working on it"); err != nil {
		t.Fatal(err)
	}

	ch, err := c.Changes(ctx, "web", false)
	if err != nil {
		t.Fatal(err)
	}
	var types []string
	for _, e := range ch.Events {
		types = append(types, e.Type)
	}
	if !slices.Contains(types, TaskAdded) {
		t.Errorf("events = %v, want a task_added", types)
	}

	// Reading advanced the cursor, so nothing is pending now.
	ch, err = c.Changes(ctx, "web", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(ch.Events) != 0 {
		t.Errorf("cursor did not advance: %+v", ch.Events)
	}
}
