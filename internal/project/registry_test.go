package project

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/walm/todomd-web/internal/todomd"
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
	// only thing that tells them apart — and for remote files the host too,
	// or two servers with an /srv/app would both be "app".
	for _, tt := range []struct {
		addr todomd.Address
		want string
	}{
		{todomd.Address{Path: "/Users/x/src/todomd-web/TODO.md"}, "todomd-web"},
		{todomd.Address{Path: "/notes.md"}, "notes"},
		{todomd.Address{Host: "web1", Path: "/srv/app/TODO.md"}, "web1:app"},
		{todomd.Address{Host: "deploy@web2", Path: "/srv/app/TODO.md"}, "deploy@web2:app"},
	} {
		if got := NameFor(tt.addr); got != tt.want {
			t.Errorf("NameFor(%+v) = %q, want %q", tt.addr, got, tt.want)
		}
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
	if _, err := r.Add(touch(t, root, "gamma"), "", ""); !errors.Is(err, ErrNotConfigurable) {
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

	if _, err := r.Add(a, "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Add(b, "Beta Project", ""); err != nil {
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
	if _, err := r.Add(a, "", ""); err != nil {
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
		if _, err := r.Add(tt.path, "", ""); err == nil {
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

	first, err := r.Add(a, "", "")
	if err != nil {
		t.Fatal(err)
	}
	again, err := r.Add(a, "", "")
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
	if _, err := r.Add(b, "", ""); err != nil {
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

func TestRenameChangesTheNameAndTheID(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "config.json")
	r, _ := Load(path)
	// Two directories called "docs" is the case that makes renaming worth
	// having: without it they are "docs" and "docs-2" forever.
	first, err := r.Add(touch(t, root, filepath.Join("todomd", "docs")), "", "")
	if err != nil {
		t.Fatal(err)
	}
	second, err := r.Add(touch(t, root, filepath.Join("house", "docs")), "", "")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != "docs" || second.ID != "docs-2" {
		t.Fatalf("ids = %v", ids(r.List()))
	}

	renamed, err := r.Rename("docs-2", "House notes")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Name != "House notes" || renamed.ID != "house-notes" {
		t.Errorf("renamed = %+v", renamed)
	}
	if _, err := r.Get("docs-2"); !errors.Is(err, ErrNotFound) {
		t.Error("the old id should be gone")
	}

	// It survives a reload, and the file it points at is unchanged.
	reloaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	entries := reloaded.List()
	if len(entries) != 2 || entries[1].Name != "House notes" || entries[1].File != second.File {
		t.Errorf("after reload: %+v", entries)
	}
}

func TestRenameKeepsItsOwnIDWhenTheSlugIsUnchanged(t *testing.T) {
	root := t.TempDir()
	r, _ := Load(filepath.Join(root, "config.json"))
	if _, err := r.Add(touch(t, root, "alpha"), "", ""); err != nil {
		t.Fatal(err)
	}
	// Renaming to something that slugs the same must not collide with itself
	// and become "alpha-2".
	renamed, err := r.Rename("alpha", "Alpha")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.ID != "alpha" || renamed.Name != "Alpha" {
		t.Errorf("renamed = %+v", renamed)
	}
}

func TestRenameCollidesLikeAddDoes(t *testing.T) {
	root := t.TempDir()
	r, _ := Load(filepath.Join(root, "config.json"))
	if _, err := r.Add(touch(t, root, "alpha"), "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Add(touch(t, root, "beta"), "", ""); err != nil {
		t.Fatal(err)
	}
	renamed, err := r.Rename("beta", "Alpha")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.ID != "alpha-2" {
		t.Errorf("id = %q, want alpha-2", renamed.ID)
	}
}

func TestRenameRejectsEmptyAndRefusesFlagLists(t *testing.T) {
	root := t.TempDir()
	r, _ := Load(filepath.Join(root, "config.json"))
	if _, err := r.Add(touch(t, root, "alpha"), "", ""); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"", "   ", "two\nlines"} {
		if _, err := r.Rename("alpha", name); err == nil {
			t.Errorf("Rename(%q) should fail", name)
		}
	}
	if _, err := r.Rename("nope", "x"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Rename(unknown) = %v", err)
	}

	fixed, _ := FromFiles([]string{touch(t, root, "gamma")})
	if _, err := fixed.Rename("gamma", "x"); !errors.Is(err, ErrNotConfigurable) {
		t.Errorf("Rename on a flag list = %v", err)
	}
}

func TestRemoteProjectsAreAcceptedWithoutTouchingTheDisk(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "config.json")
	r, _ := Load(path)

	// No os.Stat: only the remote machine can say whether the file is there,
	// and the server verifies over ssh before this is called.
	added, err := r.Add("deploy@web1:/srv/app/TODO.md", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if !added.Remote() || added.Host != "deploy@web1" {
		t.Fatalf("added = %+v", added)
	}
	if added.ID != "deploy-web1-app" || added.Name != "deploy@web1:app" {
		t.Errorf("id/name = %q / %q", added.ID, added.Name)
	}
	if added.File != "deploy@web1:/srv/app/TODO.md" {
		t.Errorf("the address should be kept as written: %q", added.File)
	}

	// A per-project todomd path survives the round trip, because a remote
	// PATH often lacks ~/.local/bin.
	if _, err := r.Add("web2:/srv/x/TODO.md", "Web 2", "/home/deploy/.local/bin/todomd"); err != nil {
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
	if entries[1].Bin != "/home/deploy/.local/bin/todomd" || entries[1].Name != "Web 2" {
		t.Errorf("second entry = %+v", entries[1])
	}
	if !entries[0].Remote() || entries[0].Host != "deploy@web1" {
		t.Errorf("first entry lost its host: %+v", entries[0])
	}
}

func TestRemoteAndLocalCoexist(t *testing.T) {
	root := t.TempDir()
	r, err := FromFiles([]string{touch(t, root, "local"), "web1:/srv/app/TODO.md"})
	if err != nil {
		t.Fatal(err)
	}
	entries := r.List()
	if len(entries) != 2 || entries[0].Remote() || !entries[1].Remote() {
		t.Fatalf("entries = %+v", entries)
	}
	if entries[1].ID != "web1-app" {
		t.Errorf("remote id = %q", entries[1].ID)
	}
}
