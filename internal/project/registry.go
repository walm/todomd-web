// Package project keeps the list of todo files this server can serve: where
// it comes from (command line or config file), what each one is called, and
// the stable id used to address it in URLs.
//
// The list is data, not state — a project is a name and a path, nothing more.
// Removing one edits the list; it never touches the file it points at.
package project

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/walm/todomd-web/internal/todomd"
)

// Entry is one todo file on the list, here or on another machine.
type Entry struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// File is a local absolute path, or scp syntax for a remote one:
	// "deploy@web1:/srv/app/TODO.md".
	File string `json:"file"`
	// Host is "" for a local file, otherwise the ssh destination.
	Host string `json:"host,omitempty"`
	// Bin overrides which todomd runs for this project. Remote hosts often
	// need it: an ssh command runs a non-interactive shell, which frequently
	// lacks ~/.local/bin.
	Bin string `json:"todomd,omitempty"`
}

// Remote reports whether this project lives on another machine.
func (e Entry) Remote() bool { return e.Host != "" }

// Address is what the todomd client takes: the file as written, so a remote
// one keeps its host.
func (e Entry) Address() string { return e.File }

// Source records where the list came from, which decides whether the UI may
// change it: a list given on the command line is the operator's, not the
// browser's.
type Source string

const (
	FromFlags  Source = "flags"
	FromConfig Source = "config"
)

// ErrNotConfigurable is returned when the list cannot be edited because it
// was given on the command line.
var ErrNotConfigurable = errors.New("projects were given on the command line; edit them there, or restart without file arguments to manage them here")

// ErrNotFound is returned for an unknown project id.
var ErrNotFound = errors.New("no such project")

type config struct {
	Projects []configEntry `json:"projects"`
}

type configEntry struct {
	Name string `json:"name,omitempty"`
	File string `json:"file"`
	// Todomd is the binary to run for this project, when the default is not
	// on the remote PATH.
	Todomd string `json:"todomd,omitempty"`
}

// Registry is the list of projects, safe for concurrent use.
type Registry struct {
	mu      sync.RWMutex
	entries []Entry
	source  Source
	path    string // config file, "" when the list came from flags
	// saved reports whether the current list is on disk; a list discovered
	// from the working directory is not written out until something changes it.
	saved bool
}

// ConfigPath returns the default config location:
// $XDG_CONFIG_HOME/todomd-web/config.json (~/.config when unset).
func ConfigPath() (string, error) {
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "todomd-web", "config.json"), nil
}

// newEntry turns a written address — a local path or scp syntax — into an
// entry, with a name if one was not given.
func newEntry(file, name, bin string) (Entry, error) {
	addr, err := todomd.ParseAddress(file)
	if err != nil {
		return Entry{}, err
	}
	e := Entry{Name: strings.TrimSpace(name), File: addr.String(), Host: addr.Host, Bin: bin}
	if e.Name == "" {
		e.Name = NameFor(addr)
	}
	return e, nil
}

// FromFiles builds a registry from paths given on the command line. The list
// is fixed for the lifetime of the process.
func FromFiles(files []string) (*Registry, error) {
	r := &Registry{source: FromFlags}
	for _, f := range files {
		e, err := newEntry(f, "", "")
		if err != nil {
			return nil, err
		}
		r.append(e)
	}
	if len(r.entries) == 0 {
		return nil, errors.New("no files given")
	}
	return r, nil
}

// Load reads the config file. A missing file is not an error: it yields an
// empty, editable registry.
func Load(path string) (*Registry, error) {
	r := &Registry{source: FromConfig, path: path}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return r, nil
	}
	if err != nil {
		return nil, err
	}
	var cfg config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	for _, entry := range cfg.Projects {
		e, err := newEntry(entry.File, entry.Name, entry.Todomd)
		if err != nil {
			return nil, err
		}
		r.append(e)
	}
	r.saved = true
	return r, nil
}

// Seed adds a file to an empty registry without writing it to disk — used for
// the file discovered in the working directory, so running todomd-web in a
// project still just works. The config file is written the first time the
// list is actually changed.
func (r *Registry) Seed(file string) error {
	e, err := newEntry(file, "", "")
	if err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.entries) > 0 {
		return nil
	}
	r.append(e)
	r.saved = false
	return nil
}

// append adds an entry with a unique id. Callers hold the lock (or are still
// constructing the registry).
func (r *Registry) append(e Entry) {
	for _, existing := range r.entries {
		if existing.File == e.File {
			return // same file twice: keep the first
		}
	}
	e.ID = r.uniqueID(Slug(e.Name))
	r.entries = append(r.entries, e)
}

// uniqueID returns base, or base-2, base-3… if it is already in use. except
// names an entry to ignore, so renaming a project can keep its own id.
func (r *Registry) uniqueID(base string, except ...string) string {
	if base == "" {
		base = "project"
	}
	skip := map[string]bool{}
	for _, id := range except {
		skip[id] = true
	}
	taken := map[string]bool{}
	for _, e := range r.entries {
		if !skip[e.ID] {
			taken[e.ID] = true
		}
	}
	if !taken[base] {
		return base
	}
	for n := 2; ; n++ {
		candidate := base + "-" + strconv.Itoa(n)
		if !taken[candidate] {
			return candidate
		}
	}
}

// List returns the projects in order.
func (r *Registry) List() []Entry {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Entry, len(r.entries))
	copy(out, r.entries)
	return out
}

// Get resolves a project id.
func (r *Registry) Get(id string) (Entry, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, e := range r.entries {
		if e.ID == id {
			return e, nil
		}
	}
	return Entry{}, ErrNotFound
}

// Configurable reports whether the list may be edited through the API.
func (r *Registry) Configurable() bool { return r.source == FromConfig }

// Path returns the config file backing this registry ("" for a flag list).
func (r *Registry) Path() string { return r.path }

// Add puts a file on the list and saves it. A local file must already exist —
// creating one is the caller's job (it needs todomd). A remote one is taken on
// trust here; the caller verifies it over ssh, where a stat would be a round
// trip and the error worth reporting is todomd's, not os.Stat's.
func (r *Registry) Add(file, name, bin string) (Entry, error) {
	if !r.Configurable() {
		return Entry{}, ErrNotConfigurable
	}
	entry, err := newEntry(file, name, bin)
	if err != nil {
		return Entry{}, err
	}
	if !entry.Remote() {
		info, err := os.Stat(entry.File)
		if err != nil {
			return Entry{}, fmt.Errorf("%s: %w", entry.File, err)
		}
		if info.IsDir() {
			return Entry{}, fmt.Errorf("%s is a directory, not a todo file", entry.File)
		}
		if !strings.EqualFold(filepath.Ext(entry.File), ".md") {
			return Entry{}, fmt.Errorf("%s is not a markdown file", entry.File)
		}
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	for _, e := range r.entries {
		if e.File == entry.File {
			return e, nil // already listed: adding twice is not an error
		}
	}
	before := len(r.entries)
	r.append(entry)
	if len(r.entries) == before {
		return Entry{}, errors.New("could not add project")
	}
	added := r.entries[len(r.entries)-1]
	if err := r.save(); err != nil {
		r.entries = r.entries[:before]
		return Entry{}, err
	}
	return added, nil
}

// Rename changes a project's name and, with it, the id it is addressed by:
// a project called "House" should not live at /p/docs-2 because that was the
// directory it happened to sit in. Returns the updated entry, whose ID the
// caller must assume has changed.
func (r *Registry) Rename(id, name string) (Entry, error) {
	if !r.Configurable() {
		return Entry{}, ErrNotConfigurable
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return Entry{}, errors.New("a project needs a name")
	}
	if strings.ContainsAny(name, "\n\r") {
		return Entry{}, errors.New("a project name must be a single line")
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	for i, e := range r.entries {
		if e.ID != id {
			continue
		}
		before := e
		e.Name = name
		e.ID = r.uniqueID(Slug(name), id)
		r.entries[i] = e
		if err := r.save(); err != nil {
			r.entries[i] = before
			return Entry{}, err
		}
		return e, nil
	}
	return Entry{}, ErrNotFound
}

// Remove drops a project from the list and saves it. The todo file itself is
// never touched.
func (r *Registry) Remove(id string) error {
	if !r.Configurable() {
		return ErrNotConfigurable
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, e := range r.entries {
		if e.ID != id {
			continue
		}
		kept := append(r.entries[:i:i], r.entries[i+1:]...)
		removed := r.entries
		r.entries = kept
		if err := r.save(); err != nil {
			r.entries = removed
			return err
		}
		return nil
	}
	return ErrNotFound
}

// save writes the whole list to the config file.
func (r *Registry) save() error {
	if r.path == "" {
		return ErrNotConfigurable
	}
	cfg := config{Projects: []configEntry{}}
	for _, e := range r.entries {
		cfg.Projects = append(cfg.Projects, configEntry{Name: e.Name, File: e.File, Todomd: e.Bin})
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err := os.MkdirAll(filepath.Dir(r.path), 0o755); err != nil {
		return err
	}
	// Same atomic write todomd uses for the todo file: a half-written config
	// would lose the list.
	tmp, err := os.CreateTemp(filepath.Dir(r.path), ".config-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), r.path); err != nil {
		return err
	}
	r.saved = true
	return nil
}

var slugUnsafe = regexp.MustCompile(`[^a-z0-9]+`)

// Slug turns a project name into something safe for a URL segment.
func Slug(name string) string {
	s := slugUnsafe.ReplaceAllString(strings.ToLower(strings.TrimSpace(name)), "-")
	return strings.Trim(s, "-")
}

// NameFor derives a project name from an address: the directory the file sits
// in, because every one of these files is called TODO.md — prefixed with the
// host when it is remote, so two servers with an /srv/app are told apart.
func NameFor(addr todomd.Address) string {
	dir := path.Base(path.Dir(addr.Path))
	if dir == "" || dir == "." || dir == "/" {
		dir = strings.TrimSuffix(path.Base(addr.Path), path.Ext(addr.Path))
	}
	if addr.Remote() {
		return addr.Host + ":" + dir
	}
	return dir
}
