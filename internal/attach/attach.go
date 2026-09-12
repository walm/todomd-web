// Package attach keeps the files attached to tasks: a screenshot pasted onto a
// card, a log, a snippet. The todo file only ever holds a markdown link to
// one; the bytes live under the state directory, never in the repository, and
// go when their task does.
//
// Everything is keyed the way todomd keys its locks and cursors — by a hash of
// the todo file's path — so renaming a project does not break a link written
// before the rename.
//
// Nothing outside this package joins paths into the tree: task ids and names
// are validated here, and a name that would change under cleaning is treated
// as absent rather than repaired.
package attach

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// MaxSize is the default cap on one attached file.
const MaxSize = 25 << 20

// SweepGrace is how recently a task's directory may have been touched and
// still be spared by Sweep: an upload can land for a task created after the
// board read the sweep is working from.
const SweepGrace = 10 * time.Minute

var (
	// ErrNotFound is returned for an attachment that is not there — including
	// one whose name or task id could never have been stored.
	ErrNotFound = errors.New("no such attachment")
	// ErrTooLarge is returned when a file exceeds the size cap.
	ErrTooLarge = errors.New("file is too large")
	// ErrInvalidTask is returned for a task id that cannot be a directory name.
	ErrInvalidTask = errors.New("invalid task id")
)

// todomd ids are four characters today; the bound leaves room for that to
// grow without letting anything path-shaped through.
var taskRe = regexp.MustCompile(`^[0-9a-z]{1,32}$`)

// Store is the attachment tree for every todo file served.
type Store struct {
	root string
}

// DefaultRoot returns $XDG_STATE_HOME/todomd-web/attachments
// (~/.local/state when unset).
func DefaultRoot() (string, error) {
	base := os.Getenv("XDG_STATE_HOME")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, ".local", "state")
	}
	return filepath.Join(base, "todomd-web", "attachments"), nil
}

// New returns a store rooted at root, which is created on first write.
func New(root string) *Store { return &Store{root: root} }

// Root returns the directory holding one todo file's attachments. file is the
// address as the project list holds it: an absolute path, or host:path.
func (s *Store) Root(file string) string {
	sum := sha256.Sum256([]byte(file))
	return filepath.Join(s.root, hex.EncodeToString(sum[:8]))
}

func (s *Store) dir(file, task string) (string, error) {
	if !taskRe.MatchString(task) {
		return "", ErrInvalidTask
	}
	return filepath.Join(s.Root(file), task), nil
}

// Saved describes a stored attachment.
type Saved struct {
	Name string `json:"name"`
	// Path is absolute, and is what the markdown link points at: an agent
	// reading the todo file can open it without knowing anything about us.
	Path     string `json:"path"`
	Size     int64  `json:"size"`
	Type     string `json:"type"`
	Markdown string `json:"markdown"`
}

// Save stores r as an attachment of task, under a cleaned version of name,
// numbered if that name is taken. A file over max is removed, not truncated.
func (s *Store) Save(file, task, name string, r io.Reader, max int64) (Saved, error) {
	dir, err := s.dir(file, task)
	if err != nil {
		return Saved{}, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return Saved{}, err
	}
	f, name, err := create(dir, CleanName(name))
	if err != nil {
		return Saved{}, err
	}
	full := filepath.Join(dir, name)

	n, err := io.Copy(f, io.LimitReader(r, max+1))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil && n > max {
		err = ErrTooLarge
	}
	if err != nil {
		_ = os.Remove(full)
		return Saved{}, err
	}
	// The directory's mtime is what Sweep's grace period reads; creating a
	// file already bumps it, this makes it explicit for a reused name.
	now := time.Now()
	_ = os.Chtimes(dir, now, now)

	saved := Saved{Name: name, Path: full, Size: n, Type: TypeOf(name)}
	saved.Markdown = Markdown(saved)
	return saved, nil
}

// create opens name for writing without replacing anything there, trying
// "name-2.ext", "name-3.ext"… when it is taken.
func create(dir, name string) (*os.File, string, error) {
	ext := path.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 1; i <= 1000; i++ {
		candidate := name
		if i > 1 {
			candidate = fmt.Sprintf("%s-%d%s", stem, i, ext)
		}
		f, err := os.OpenFile(filepath.Join(dir, candidate), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err == nil {
			return f, candidate, nil
		}
		if !errors.Is(err, fs.ErrExist) {
			return nil, "", err
		}
	}
	return nil, "", fmt.Errorf("too many attachments named %s", name)
}

// Open returns a stored attachment for reading. Anything that is not a regular
// file inside the task's directory — a symlink, a cleaned-away name — is
// ErrNotFound.
func (s *Store) Open(file, task, name string) (*os.File, fs.FileInfo, error) {
	dir, err := s.dir(file, task)
	if err != nil || name == "" || name != CleanName(name) {
		return nil, nil, ErrNotFound
	}
	full := filepath.Join(dir, name)
	info, err := os.Lstat(full)
	if err != nil || !info.Mode().IsRegular() {
		return nil, nil, ErrNotFound
	}
	f, err := os.Open(full)
	if err != nil {
		return nil, nil, ErrNotFound
	}
	return f, info, nil
}

// RemoveTask deletes everything attached to task. A task with no attachments
// is not an error.
func (s *Store) RemoveTask(file, task string) error {
	dir, err := s.dir(file, task)
	if err != nil {
		return err
	}
	return os.RemoveAll(dir)
}

// RemoveFile deletes one attachment, for undoing an upload that did not
// finish. A name the store could not have written is ignored.
func (s *Store) RemoveFile(file, task, name string) {
	dir, err := s.dir(file, task)
	if err != nil || name == "" || name != CleanName(name) {
		return
	}
	_ = os.Remove(filepath.Join(dir, name))
}

// Sweep removes the attachments of every task not in live, returning the ids
// it removed. live must come from a successful read of the file: an empty set
// means "no tasks", and would take everything with it.
func (s *Store) Sweep(file string, live map[string]bool) ([]string, error) {
	entries, err := os.ReadDir(s.Root(file))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var removed []string
	cutoff := time.Now().Add(-SweepGrace)
	for _, e := range entries {
		// Type is from the directory listing, so a symlink reads as one and
		// is never followed out of the tree.
		if !e.IsDir() || !taskRe.MatchString(e.Name()) || live[e.Name()] {
			continue
		}
		info, err := e.Info()
		if err != nil || info.ModTime().After(cutoff) {
			continue
		}
		if err := os.RemoveAll(filepath.Join(s.Root(file), e.Name())); err != nil {
			return removed, err
		}
		removed = append(removed, e.Name())
	}
	return removed, nil
}

const maxName = 100

// CleanName turns whatever a browser sent as a filename into one that is safe
// as a single path segment and as a markdown link target: the base name only,
// no control characters, none of the characters Windows or a link would choke
// on, no leading dots, at most 100 bytes with the extension kept.
func CleanName(name string) string {
	name = path.Base(strings.ReplaceAll(name, `\`, "/"))
	name = strings.Map(func(r rune) rune {
		switch {
		case r == utf8.RuneError, r == '/', unicode.IsControl(r):
			// Base leaves a lone "/" for a name that was only separators.
			return -1
		case strings.ContainsRune(`<>:"|?*`, r):
			return '-'
		}
		return r
	}, name)
	name = strings.TrimLeft(strings.TrimSpace(name), ".")
	name = strings.TrimSpace(name)
	if name == "" {
		return "file"
	}
	if len(name) <= maxName {
		return name
	}
	ext := path.Ext(name)
	if len(ext) > 16 {
		ext = ""
	}
	stem := strings.TrimSuffix(name, ext)
	limit := maxName - len(ext)
	for len(stem) > limit || !utf8.ValidString(stem) {
		stem = stem[:len(stem)-1]
	}
	return strings.TrimSpace(stem) + ext
}

var imageTypes = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true,
	".webp": true, ".avif": true, ".svg": true, ".bmp": true,
}

// IsImage reports whether a name should be linked as an image.
func IsImage(name string) bool {
	return imageTypes[strings.ToLower(path.Ext(name))]
}

// inline is what a browser may show rather than download. Everything else is
// served as an attachment, whatever its type.
var inline = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true,
	".avif": true, ".svg": true, ".bmp": true, ".pdf": true, ".txt": true,
	".md": true, ".log": true,
}

// Inline reports whether a name is safe to show in the browser.
func Inline(name string) bool {
	return inline[strings.ToLower(path.Ext(name))]
}

// TypeOf returns the content type for a name, from its extension alone —
// never from what the uploader claimed. Text-like files are served as plain
// text so a browser shows them rather than guessing.
func TypeOf(name string) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".md", ".txt", ".log":
		return "text/plain; charset=utf-8"
	}
	if t := mime.TypeByExtension(path.Ext(name)); t != "" {
		return t
	}
	return "application/octet-stream"
}

// Markdown is the link to put in a description or comment: an image for an
// image, a plain link otherwise. The target goes in angle brackets when it
// holds anything that would end a bare one.
func Markdown(a Saved) string {
	text := strings.NewReplacer(`\`, `\\`, `[`, `\[`, `]`, `\]`).Replace(a.Name)
	target := a.Path
	if strings.ContainsAny(target, " ()") {
		target = "<" + target + ">"
	}
	link := "[" + text + "](" + target + ")"
	if IsImage(a.Name) {
		return "!" + link
	}
	return link
}
