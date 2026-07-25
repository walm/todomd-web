package project

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// touch creates dir/TODO.md under a temp root and returns its path.
func touch(t *testing.T, root, dir string) string {
	t.Helper()
	full := filepath.Join(root, dir)
	if err := os.MkdirAll(full, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(full, "TODO.md")
	if err := os.WriteFile(file, []byte("# TODO\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return file
}

func ids(entries []Entry) []string {
	out := make([]string, len(entries))
	for i, e := range entries {
		out[i] = e.ID
	}
	return out
}

func TestNamesComeFromTheDirectory(t *testing.T) {
	// Every one of these files is called TODO.md, so the directory is the
	// only thing that tells them apart.
	if got := NameFor("/Users/x/src/todomd-web/TODO.md"); got != "todomd-web" {
		t.Errorf("NameFor = %q", got)
	}
	if got := NameFor("/notes.md"); got != "notes" {
		t.Errorf("NameFor at the root = %q", got)
	}
}

func TestSlug(t *testing.T) {
	for input, want := range map[string]string{
		"todomd-web": "todomd-web",
		"My Notes!":  "my-notes",
		"  spaced  ": "spaced",
		"...":        "",
		// Accented letters are dropped rather than transliterated; what
		// survives still has to be a usable URL segment, and a name that
		// leaves nothing behind falls back to "project" when the id is
		// assigned.
		"Ünï dö": "n-d",
	} {
		if got := Slug(input); got != want {
			t.Errorf("Slug(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestFromFilesIsFixed(t *testing.T) {
	root := t.TempDir()
	a, b := touch(t, root, "alpha"), touch(t, root, "beta")

	r, err := FromFiles([]string{a, b})
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(r.List()); len(got) != 2 || got[0] != "alpha" || got[1] != "beta" {
		t.Fatalf("ids = %v", got)
	}
	if r.Configurable() {
		t.Error("a list from the command line must not be editable through the API")
	}
	if _, err := r.Add(touch(t, root, "gamma"), ""); !errors.Is(err, ErrNotConfigurable) {
		t.Errorf("Add = %v, want ErrNotConfigurable", err)
	}
	if err := r.Remove("alpha"); !errors.Is(err, ErrNotConfigurable) {
		t.Errorf("Remove = %v, want ErrNotConfigurable", err)
	}
}

func TestDuplicateFilesAndNamesAreResolved(t *testing.T) {
	root := t.TempDir()
	a := touch(t, root, "docs")
	b := touch(t, root, filepath.Join("other", "docs"))

	r, err := FromFiles([]string{a, b, a})
	if err != nil {
		t.Fatal(err)
	}
	got := ids(r.List())
	if len(got) != 2 {
		t.Fatalf("the same file twice should collapse: %v", got)
	}
	if got[0] != "docs" || got[1] != "docs-2" {
		t.Errorf("colliding names should be suffixed, got %v", got)
	}
}

func TestConfigRoundTrip(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "config", "config.json")
	a, b := touch(t, root, "alpha"), touch(t, root, "beta")

	// A missing config is an empty, editable registry — not an error.
	r, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.List()) != 0 || !r.Configurable() {
		t.Fatalf("fresh registry = %+v", r.List())
	}

	if _, err := r.Add(a, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Add(b, "Beta Project"); err != nil {
		t.Fatal(err)
	}

	reloaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	entries := reloaded.List()
	if len(entries) != 2 {
		t.Fatalf("entries = %+v", entries)
	}
	if entries[0].ID != "alpha" || entries[1].ID != "beta-project" {
		t.Errorf("ids = %v", ids(entries))
	}
	if entries[1].Name != "Beta Project" {
		t.Errorf("name was not kept: %q", entries[1].Name)
	}
}

func TestRemoveOnlyEditsTheList(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "config.json")
	a := touch(t, root, "alpha")

	r, _ := Load(path)
	if _, err := r.Add(a, ""); err != nil {
		t.Fatal(err)
	}
	if err := r.Remove("alpha"); err != nil {
		t.Fatal(err)
	}
	if len(r.List()) != 0 {
		t.Errorf("still listed: %+v", r.List())
	}
	// The whole point: the todo file is untouched.
	if _, err := os.Stat(a); err != nil {
		t.Errorf("removing a project deleted the file: %v", err)
	}
	if err := r.Remove("alpha"); !errors.Is(err, ErrNotFound) {
		t.Errorf("removing twice = %v, want ErrNotFound", err)
	}
}

func TestAddRejectsWhatIsNotATodoFile(t *testing.T) {
	root := t.TempDir()
	r, _ := Load(filepath.Join(root, "config.json"))

	notes := filepath.Join(root, "notes.txt")
	if err := os.WriteFile(notes, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct{ name, path string }{
		{"missing", filepath.Join(root, "nope", "TODO.md")},
		{"directory", root},
		{"not markdown", notes},
	} {
		if _, err := r.Add(tt.path, ""); err == nil {
			t.Errorf("%s: expected an error", tt.name)
		}
	}
	if len(r.List()) != 0 {
		t.Errorf("a rejected add still changed the list: %+v", r.List())
	}
}

func TestAddingTheSameFileTwiceIsFine(t *testing.T) {
	root := t.TempDir()
	r, _ := Load(filepath.Join(root, "config.json"))
	a := touch(t, root, "alpha")

	first, err := r.Add(a, "")
	if err != nil {
		t.Fatal(err)
	}
	again, err := r.Add(a, "")
	if err != nil {
		t.Fatalf("adding an already-listed project should be a no-op: %v", err)
	}
	if first.ID != again.ID || len(r.List()) != 1 {
		t.Errorf("list = %+v", r.List())
	}
}

func TestSeedIsNotWrittenUntilSomethingChanges(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "config.json")
	a, b := touch(t, root, "alpha"), touch(t, root, "beta")

	r, _ := Load(path)
	if err := r.Seed(a); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("discovering a file in the working directory should not write config")
	}

	// …but once the list is edited, the discovered project is saved with it.
	if _, err := r.Add(b, ""); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var cfg config
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatal(err)
	}
	if len(cfg.Projects) != 2 || cfg.Projects[0].File != a {
		t.Errorf("config = %+v", cfg.Projects)
	}
}

func TestGet(t *testing.T) {
	root := t.TempDir()
	r, _ := FromFiles([]string{touch(t, root, "alpha")})
	if e, err := r.Get("alpha"); err != nil || e.File == "" {
		t.Fatalf("Get = %+v, %v", e, err)
	}
	if _, err := r.Get("nope"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Get(unknown) = %v", err)
	}
}
