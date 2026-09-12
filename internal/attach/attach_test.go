package attach

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestCleanName(t *testing.T) {
	cases := map[string]string{
		"shot.png":           "shot.png",
		"../../etc/passwd":   "passwd",
		`C:\Users\me\x.txt`:  "x.txt",
		"/":                  "file",
		"..":                 "file",
		"":                   "file",
		".env":               "env",
		"  spaced name.md  ": "spaced name.md",
		"bell\a\n.txt":       "bell.txt",
		`a<b>c:"d|e?f*.log`:  "a-b-c--d-e-f-.log",
		"skärmbild 1.png":    "skärmbild 1.png",
	}
	for in, want := range cases {
		if got := CleanName(in); got != want {
			t.Errorf("CleanName(%q) = %q, want %q", in, got, want)
		}
	}

	long := CleanName(strings.Repeat("å", 80) + ".png")
	if len(long) > maxName || !strings.HasSuffix(long, ".png") {
		t.Errorf("long name = %q (%d bytes)", long, len(long))
	}
	if long != CleanName(long) {
		t.Error("a cleaned name must be stable under cleaning, or Open would refuse it")
	}
}

func TestRootIsKeyedByFile(t *testing.T) {
	s := New(t.TempDir())
	a, b := s.Root("/src/a/TODO.md"), s.Root("/src/b/TODO.md")
	if a == b {
		t.Error("different files must get different roots")
	}
	if a != s.Root("/src/a/TODO.md") {
		t.Error("the root must be stable, or yesterday's links break")
	}
	if !strings.HasPrefix(a, s.root) {
		t.Errorf("root %q is outside the store", a)
	}
}

func TestSaveOpenAndDedupe(t *testing.T) {
	s := New(t.TempDir())
	const file = "/src/app/TODO.md"

	first, err := s.Save(file, "3f2a", "shot.png", strings.NewReader("one"), MaxSize)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Save(file, "3f2a", "shot.png", strings.NewReader("two"), MaxSize)
	if err != nil {
		t.Fatal(err)
	}
	if first.Name != "shot.png" || second.Name != "shot-2.png" {
		t.Errorf("names = %q, %q", first.Name, second.Name)
	}
	if first.Path != filepath.Join(s.Root(file), "3f2a", "shot.png") || first.Size != 3 {
		t.Errorf("saved = %+v", first)
	}
	if first.Type != "image/png" || first.Markdown != "![shot.png]("+first.Path+")" {
		t.Errorf("saved = %+v", first)
	}

	f, info, err := s.Open(file, "3f2a", "shot-2.png")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if info.Size() != 3 {
		t.Errorf("size = %d", info.Size())
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("mode = %v, want private", mode)
	}
}

func TestSaveRefusesOversizeAndBadIDs(t *testing.T) {
	s := New(t.TempDir())
	const file = "/src/app/TODO.md"

	if _, err := s.Save(file, "3f2a", "big.bin", strings.NewReader("12345"), 4); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("err = %v, want ErrTooLarge", err)
	}
	if _, _, err := s.Open(file, "3f2a", "big.bin"); !errors.Is(err, ErrNotFound) {
		t.Error("an oversize file must not be left behind")
	}
	if _, err := s.Save(file, "4", "exact.bin", strings.NewReader("1234"), 4); err != nil {
		t.Errorf("a file exactly at the cap is fine: %v", err)
	}

	for _, id := range []string{"", "..", "3F2A", "a/b", strings.Repeat("a", 33)} {
		if _, err := s.Save(file, id, "x.txt", strings.NewReader("x"), MaxSize); !errors.Is(err, ErrInvalidTask) {
			t.Errorf("Save with task %q: err = %v", id, err)
		}
	}
}

func TestOpenRefusesAnythingItDidNotStore(t *testing.T) {
	root := t.TempDir()
	s := New(root)
	const file = "/src/app/TODO.md"
	if _, err := s.Save(file, "3f2a", "ok.txt", strings.NewReader("x"), MaxSize); err != nil {
		t.Fatal(err)
	}
	secret := filepath.Join(root, "secret.txt")
	if err := os.WriteFile(secret, []byte("no"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(secret, filepath.Join(s.Root(file), "3f2a", "link.txt")); err != nil {
		t.Fatal(err)
	}

	for _, c := range []struct{ task, name string }{
		{"3f2a", "../../secret.txt"},
		{"3f2a", ".."},
		{"3f2a", ""},
		{"..", "secret.txt"},
		{"3f2a", "link.txt"},
		{"3f2a", "missing.txt"},
	} {
		if f, _, err := s.Open(file, c.task, c.name); !errors.Is(err, ErrNotFound) {
			if f != nil {
				f.Close()
			}
			t.Errorf("Open(%q, %q): err = %v, want ErrNotFound", c.task, c.name, err)
		}
	}
}

func TestRemoveTask(t *testing.T) {
	s := New(t.TempDir())
	const file = "/src/app/TODO.md"
	if _, err := s.Save(file, "3f2a", "x.txt", strings.NewReader("x"), MaxSize); err != nil {
		t.Fatal(err)
	}
	if err := s.RemoveTask(file, "3f2a"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(s.Root(file), "3f2a")); !errors.Is(err, os.ErrNotExist) {
		t.Error("the task's directory should be gone")
	}
	if err := s.RemoveTask(file, "zzzz"); err != nil {
		t.Errorf("removing a task with nothing attached: %v", err)
	}
	if err := s.RemoveTask(file, "../.."); !errors.Is(err, ErrInvalidTask) {
		t.Errorf("err = %v, want ErrInvalidTask", err)
	}
}

func TestSweep(t *testing.T) {
	s := New(t.TempDir())
	const file = "/src/app/TODO.md"
	old := time.Now().Add(-2 * SweepGrace)
	for _, id := range []string{"live", "dead", "new0"} {
		if _, err := s.Save(file, id, "x.txt", strings.NewReader("x"), MaxSize); err != nil {
			t.Fatal(err)
		}
		if id != "new0" {
			if err := os.Chtimes(filepath.Join(s.Root(file), id), old, old); err != nil {
				t.Fatal(err)
			}
		}
	}
	// Something that is not a task directory is never touched.
	stray := filepath.Join(s.Root(file), "NOT-A-TASK")
	if err := os.Mkdir(stray, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(stray, old, old); err != nil {
		t.Fatal(err)
	}

	removed, err := s.Sweep(file, map[string]bool{"live": true})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(removed, []string{"dead"}) {
		t.Errorf("removed = %v, want just the dead task: live stays, and new0 is inside the grace period", removed)
	}
	for _, keep := range []string{"live", "new0", "NOT-A-TASK"} {
		if _, err := os.Stat(filepath.Join(s.Root(file), keep)); err != nil {
			t.Errorf("%s should survive the sweep: %v", keep, err)
		}
	}

	if removed, err := s.Sweep("/never/attached/TODO.md", nil); err != nil || removed != nil {
		t.Errorf("sweeping a file with no attachments = %v, %v", removed, err)
	}
}

func TestMarkdown(t *testing.T) {
	cases := []struct {
		saved Saved
		want  string
	}{
		{Saved{Name: "a.png", Path: "/s/a.png"}, "![a.png](/s/a.png)"},
		{Saved{Name: "log.txt", Path: "/s/log.txt"}, "[log.txt](/s/log.txt)"},
		{Saved{Name: "b.PNG", Path: "/Users/Jane Smith/b.PNG"}, "![b.PNG](</Users/Jane Smith/b.PNG>)"},
		{Saved{Name: "[x] (1).md", Path: "/s/[x] (1).md"}, `[\[x\] (1).md](</s/[x] (1).md>)`},
	}
	for _, c := range cases {
		if got := Markdown(c.saved); got != c.want {
			t.Errorf("Markdown(%+v) = %s, want %s", c.saved, got, c.want)
		}
	}
}

func TestTypesComeFromTheExtension(t *testing.T) {
	if TypeOf("notes.md") != "text/plain; charset=utf-8" || TypeOf("x.unknownext") != "application/octet-stream" {
		t.Error("unexpected types")
	}
	if !Inline("shot.PNG") || Inline("page.html") || Inline("run.sh") {
		t.Error("only a small allowlist is shown inline")
	}
}

func TestClaimHandsADraftToItsTask(t *testing.T) {
	s := New(t.TempDir())
	const file, draft = "/src/app/TODO.md", "0123456789abcdef0123"

	shot, err := s.SaveDraft(file, draft, "shot.png", strings.NewReader("png"), MaxSize)
	if err != nil {
		t.Fatal(err)
	}
	from, to, err := s.Claim(file, draft, "3f2a")
	if err != nil {
		t.Fatal(err)
	}
	if from != filepath.Dir(shot.Path) || to != filepath.Join(s.Root(file), "3f2a") {
		t.Errorf("claim = %q → %q", from, to)
	}
	// Both paths resolve until the caller has rewritten the links.
	for _, p := range []string{shot.Path, filepath.Join(to, "shot.png")} {
		if data, err := os.ReadFile(p); err != nil || string(data) != "png" {
			t.Errorf("%s: %q, %v", p, data, err)
		}
	}
	if err := s.RemoveDraft(file, draft); err != nil {
		t.Fatal(err)
	}
	if f, _, err := s.Open(file, "3f2a", "shot.png"); err != nil {
		t.Errorf("the task keeps the file once the draft is gone: %v", err)
	} else {
		f.Close()
	}

	if from, _, err := s.Claim(file, "ffffffffffffffffffff", "3f2b"); err != nil || from != "" {
		t.Errorf("claiming an empty draft = %q, %v", from, err)
	}
	for _, bad := range []string{"short", "../../../../etc", "UPPERCASEUPPERCASE"} {
		if _, err := s.SaveDraft(file, bad, "x.txt", strings.NewReader("x"), MaxSize); !errors.Is(err, ErrInvalidDraft) {
			t.Errorf("SaveDraft(%q): err = %v", bad, err)
		}
	}
}

func TestSweepExpiresDraftsButNotSoon(t *testing.T) {
	s := New(t.TempDir())
	const file = "/src/app/TODO.md"
	stale, fresh := "aaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbb"
	for _, d := range []string{stale, fresh} {
		if _, err := s.SaveDraft(file, d, "x.txt", strings.NewReader("x"), MaxSize); err != nil {
			t.Fatal(err)
		}
	}
	// Older than a task's grace, younger than a draft's: a dialog left open.
	notYet := time.Now().Add(-2 * SweepGrace)
	old := time.Now().Add(-2 * DraftTTL)
	drafts := filepath.Join(s.Root(file), draftsDir)
	_ = os.Chtimes(filepath.Join(drafts, fresh), notYet, notYet)
	_ = os.Chtimes(filepath.Join(drafts, stale), old, old)
	_ = os.Chtimes(drafts, old, old)

	if _, err := s.Sweep(file, map[string]bool{}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(drafts, stale)); !errors.Is(err, os.ErrNotExist) {
		t.Error("a day-old draft should be swept")
	}
	if _, err := os.Stat(filepath.Join(drafts, fresh)); err != nil {
		t.Errorf("a draft still being written must survive: %v", err)
	}
}
