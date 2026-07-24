package todomd

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// fakeClient returns a client whose "todomd" records the argv it was called
// with (one argument per line in the returned path) and prints stdout.
func fakeClient(t *testing.T, stdout string, exitCode int) (*Client, string) {
	t.Helper()
	dir := t.TempDir()
	argsFile := filepath.Join(dir, "args")
	outFile := filepath.Join(dir, "stdout")
	if err := os.WriteFile(outFile, []byte(stdout), 0o644); err != nil {
		t.Fatal(err)
	}
	script := "#!/bin/sh\n" +
		"printf '%s\\0' \"$@\" > \"$TODOMD_FAKE_ARGS\"\n" +
		"if [ \"$TODOMD_FAKE_EXIT\" != 0 ]; then echo 'todomd: no task with id \"zz\"' >&2; exit \"$TODOMD_FAKE_EXIT\"; fi\n" +
		"cat \"$TODOMD_FAKE_STDOUT\"\n"
	bin := filepath.Join(dir, "todomd")
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TODOMD_FAKE_ARGS", argsFile)
	t.Setenv("TODOMD_FAKE_STDOUT", outFile)
	t.Setenv("TODOMD_FAKE_EXIT", strconv.Itoa(exitCode))
	return &Client{Bin: bin, File: "/tmp/TODO.md"}, argsFile
}

func recordedArgs(t *testing.T, path string) []string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("no args recorded: %v", err)
	}
	// NUL-separated so that empty arguments survive the round trip.
	return strings.Split(strings.TrimSuffix(string(data), "\x00"), "\x00")
}

const oneTask = `{"id":"3f2a","board":"Backlog","title":"Fix parser","tags":["core"],"due":"2026-08-01","description":"body","comments":[{"author":"user","date":"2026-07-24","text":"hi"}]}`

func str(s string) *string { return &s }

func TestArgConstruction(t *testing.T) {
	tests := []struct {
		name string
		call func(*Client) error
		want []string
	}{
		{
			"list",
			func(c *Client) error { _, err := c.List(t.Context()); return err },
			[]string{"--file", "/tmp/TODO.md", "list", "--json"},
		},
		{
			"show",
			func(c *Client) error { _, err := c.Show(t.Context(), "3f2a"); return err },
			[]string{"--file", "/tmp/TODO.md", "show", "3f2a", "--json"},
		},
		{
			"add full",
			func(c *Client) error {
				_, err := c.Add(t.Context(), NewTask{
					Board: "In Progress", Title: "New task", Description: "desc",
					Tags: []string{"a", "b"}, Due: "2026-09-01",
				})
				return err
			},
			[]string{"--file", "/tmp/TODO.md", "add", "New task", "--json",
				"--board", "In Progress", "--desc", "desc", "--tag", "a", "--tag", "b", "--due", "2026-09-01"},
		},
		{
			"add minimal omits empty flags",
			func(c *Client) error { _, err := c.Add(t.Context(), NewTask{Title: "bare"}); return err },
			[]string{"--file", "/tmp/TODO.md", "add", "bare", "--json"},
		},
		{
			"update title and description",
			func(c *Client) error {
				_, err := c.Update(t.Context(), "3f2a", Update{Title: str("T"), Description: str("")})
				return err
			},
			[]string{"--file", "/tmp/TODO.md", "update", "3f2a", "--json", "--title", "T", "--desc", ""},
		},
		{
			"update clearing tags and due",
			func(c *Client) error {
				empty := []string{}
				_, err := c.Update(t.Context(), "3f2a", Update{Tags: &empty, Due: str("")})
				return err
			},
			[]string{"--file", "/tmp/TODO.md", "update", "3f2a", "--json", "--clear-tags", "--clear-due"},
		},
		{
			"update replacing tags",
			func(c *Client) error {
				tags := []string{"x", "y"}
				_, err := c.Update(t.Context(), "3f2a", Update{Tags: &tags})
				return err
			},
			[]string{"--file", "/tmp/TODO.md", "update", "3f2a", "--json", "--tag", "x", "--tag", "y"},
		},
		{
			"move to board and position",
			func(c *Client) error { _, err := c.Move(t.Context(), "3f2a", "Done", 2); return err },
			[]string{"--file", "/tmp/TODO.md", "move", "3f2a", "--json", "--to", "Done", "--pos", "2"},
		},
		{
			"move appends when pos is zero",
			func(c *Client) error { _, err := c.Move(t.Context(), "3f2a", "Done", 0); return err },
			[]string{"--file", "/tmp/TODO.md", "move", "3f2a", "--json", "--to", "Done"},
		},
		{
			"comment",
			func(c *Client) error {
				_, err := c.Comment(t.Context(), "3f2a", "user", "multi\nline $text")
				return err
			},
			[]string{"--file", "/tmp/TODO.md", "comment", "3f2a", "multi\nline $text", "--author", "user", "--json"},
		},
		{
			"delete is non-interactive",
			func(c *Client) error { _, err := c.Delete(t.Context(), "3f2a"); return err },
			[]string{"--file", "/tmp/TODO.md", "delete", "3f2a", "--yes", "--json"},
		},
		{
			"changes",
			func(c *Client) error {
				_, err := c.Changes(t.Context(), "web", true, "ai")
				return err
			},
			[]string{"--file", "/tmp/TODO.md", "changes", "--as", "web", "--json", "--peek", "--ignore-author", "ai"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, argsFile := fakeClient(t, `{"file":"/tmp/TODO.md","boards":[]}`, 0)
			if err := tt.call(c); err != nil {
				t.Fatalf("call failed: %v", err)
			}
			if got := recordedArgs(t, argsFile); !slices.Equal(got, tt.want) {
				t.Errorf("argv mismatch\n got: %q\nwant: %q", got, tt.want)
			}
		})
	}
}

func TestDecodesTask(t *testing.T) {
	c, _ := fakeClient(t, oneTask, 0)
	got, err := c.Show(t.Context(), "3f2a")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "3f2a" || got.Title != "Fix parser" || got.Board != "Backlog" {
		t.Errorf("unexpected task: %+v", got)
	}
	if got.Due == nil || *got.Due != "2026-08-01" {
		t.Errorf("due = %v", got.Due)
	}
	if len(got.Comments) != 1 || got.Comments[0].Author != "user" {
		t.Errorf("comments = %+v", got.Comments)
	}
}

func TestExitCodesBecomeTypedErrors(t *testing.T) {
	for _, tt := range []struct {
		code            int
		notFound, ambig bool
	}{
		{1, false, false},
		{2, true, false},
		{3, false, true},
	} {
		c, _ := fakeClient(t, "", tt.code)
		_, err := c.Show(t.Context(), "zz")
		var e *Error
		if !errors.As(err, &e) {
			t.Fatalf("exit %d: want *todomd.Error, got %v", tt.code, err)
		}
		if e.Code != tt.code || e.NotFound() != tt.notFound || e.Ambiguous() != tt.ambig {
			t.Errorf("exit %d: got %+v", tt.code, e)
		}
		if !strings.Contains(e.Error(), "no task with id") {
			t.Errorf("exit %d: stderr not surfaced: %q", tt.code, e.Error())
		}
		if strings.HasPrefix(e.Error(), "todomd: ") {
			t.Errorf("exit %d: message keeps the CLI prefix: %q", tt.code, e.Error())
		}
	}
}

func TestUpdateRejectsEmptyChange(t *testing.T) {
	c, _ := fakeClient(t, "", 0)
	if _, err := c.Update(t.Context(), "3f2a", Update{}); err == nil {
		t.Error("want an error for an update with no fields")
	}
}

func TestMoveRejectsNoTarget(t *testing.T) {
	c, _ := fakeClient(t, "", 0)
	if _, err := c.Move(t.Context(), "3f2a", "", 0); err == nil {
		t.Error("want an error for a move with neither board nor position")
	}
}

func TestNewReportsMissingBinary(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	if _, err := New(context.Background(), "definitely-not-todomd", ""); !errors.Is(err, ErrNotInstalled) {
		t.Errorf("got %v, want ErrNotInstalled", err)
	}
}
