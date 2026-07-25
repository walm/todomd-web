package todomd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// DefaultBin is the command looked up on PATH when none is configured.
const DefaultBin = "todomd"

// ErrNotInstalled is returned when the todomd binary cannot be found.
var ErrNotInstalled = errors.New("todomd not found on PATH — install it from https://github.com/walm/todomd")

// Error is a failed todomd invocation. Code is the process exit code, which
// todomd defines as: 1 general, 2 task not found, 3 ambiguous ID prefix.
type Error struct {
	Code int
	Args []string
	Msg  string
}

func (e *Error) Error() string {
	if e.Msg != "" {
		return e.Msg
	}
	return fmt.Sprintf("todomd %s: exit %d", strings.Join(e.Args, " "), e.Code)
}

// NotFound reports whether the referenced task does not exist.
func (e *Error) NotFound() bool { return e.Code == 2 }

// Ambiguous reports whether an ID prefix matched more than one task.
func (e *Error) Ambiguous() bool { return e.Code == 3 }

// Client runs todomd against one todo file.
type Client struct {
	Bin  string // resolved path to the todomd binary
	File string // absolute path to the todo file
}

// New resolves the todomd binary and the todo file it should operate on.
// bin defaults to "todomd" on PATH; file may be empty, in which case todomd's
// own discovery (TODOMD_FILE, then TODO.md searched upward from the working
// directory) decides, and the resolved path is read back from the CLI.
func New(ctx context.Context, bin, file string) (*Client, error) {
	if bin == "" {
		bin = DefaultBin
	}
	path, err := exec.LookPath(bin)
	if err != nil {
		return nil, ErrNotInstalled
	}
	c := &Client{Bin: path}
	if file != "" {
		abs, err := filepath.Abs(file)
		if err != nil {
			return nil, err
		}
		c.File = abs
	}
	// Round-trip through the CLI: proves todomd works, that the file exists
	// and parses, and (when discovered) what its path is.
	f, err := c.List(ctx)
	if err != nil {
		return nil, err
	}
	c.File = f.Path
	return c, nil
}

// run executes todomd with the given arguments, always scoped to the client's
// file, and returns stdout.
func (c *Client) run(ctx context.Context, args ...string) ([]byte, error) {
	full := args
	if c.File != "" {
		full = append([]string{"--file", c.File}, args...)
	}
	cmd := exec.CommandContext(ctx, c.Bin, full...)
	// No shell is involved, so titles, descriptions and comments containing
	// quotes, newlines or $ need no escaping.
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			return nil, &Error{
				Code: ee.ExitCode(),
				Args: full,
				Msg:  strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(stderr.String()), "todomd: ")),
			}
		}
		return nil, fmt.Errorf("running %s: %w", c.Bin, err)
	}
	return []byte(stdout.String()), nil
}

func runJSON[T any](ctx context.Context, c *Client, args ...string) (*T, error) {
	out, err := c.run(ctx, args...)
	if err != nil {
		return nil, err
	}
	var v T
	if err := json.Unmarshal(out, &v); err != nil {
		return nil, fmt.Errorf("decoding output of todomd %s: %w", strings.Join(args, " "), err)
	}
	return &v, nil
}

// Version returns the todomd version string (e.g. "v0.1.0").
func (c *Client) Version(ctx context.Context) string {
	cmd := exec.CommandContext(ctx, c.Bin, "--version")
	out, err := cmd.Output()
	if err != nil {
		return "unknown"
	}
	// "todomd version v0.1.0"
	fields := strings.Fields(string(out))
	if len(fields) == 0 {
		return "unknown"
	}
	return fields[len(fields)-1]
}

// Rev is a cheap fingerprint of the file's current state (size and
// modification time), used by clients to notice they are showing stale data.
func (c *Client) Rev() string {
	st, err := os.Stat(c.File)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%d-%d", st.Size(), st.ModTime().UnixNano())
}

// List returns the whole board.
func (c *Client) List(ctx context.Context) (*File, error) {
	return runJSON[File](ctx, c, "list", "--json")
}

// Show returns one task by ID or unique prefix.
func (c *Client) Show(ctx context.Context, id string) (*Task, error) {
	return runJSON[Task](ctx, c, "show", id, "--json")
}

// Boards returns the board names with their task counts.
func (c *Client) Boards(ctx context.Context) ([]BoardCount, error) {
	v, err := runJSON[struct {
		Boards []BoardCount `json:"boards"`
	}](ctx, c, "boards", "--json")
	if err != nil {
		return nil, err
	}
	return v.Boards, nil
}

// Add creates a task and returns it.
func (c *Client) Add(ctx context.Context, t NewTask) (*Task, error) {
	args := []string{"add", t.Title, "--json"}
	if t.Board != "" {
		args = append(args, "--board", t.Board)
	}
	if t.Description != "" {
		args = append(args, "--desc", t.Description)
	}
	for _, tag := range t.Tags {
		args = append(args, "--tag", tag)
	}
	if t.Due != "" {
		args = append(args, "--due", t.Due)
	}
	return runJSON[Task](ctx, c, args...)
}

// Update applies the given field changes to a task and returns it.
func (c *Client) Update(ctx context.Context, id string, u Update) (*Task, error) {
	if u.IsEmpty() {
		return nil, errors.New("nothing to update")
	}
	args := []string{"update", id, "--json"}
	if u.Title != nil {
		args = append(args, "--title", *u.Title)
	}
	if u.Description != nil {
		args = append(args, "--desc", *u.Description)
	}
	if u.Tags != nil {
		if len(*u.Tags) == 0 {
			args = append(args, "--clear-tags")
		}
		for _, tag := range *u.Tags {
			args = append(args, "--tag", tag)
		}
	}
	if u.Due != nil {
		if *u.Due == "" {
			args = append(args, "--clear-due")
		} else {
			args = append(args, "--due", *u.Due)
		}
	}
	return runJSON[Task](ctx, c, args...)
}

// Move relocates a task. to is the target board ("" keeps the current one,
// a missing board is created); pos is a 1-based position in the target after
// removal, 0 appends.
func (c *Client) Move(ctx context.Context, id, to string, pos int) (*Task, error) {
	if to == "" && pos <= 0 {
		return nil, errors.New("move needs a target board or position")
	}
	args := []string{"move", id, "--json"}
	if to != "" {
		args = append(args, "--to", to)
	}
	if pos > 0 {
		args = append(args, "--pos", strconv.Itoa(pos))
	}
	return runJSON[Task](ctx, c, args...)
}

// Comment appends a comment dated today and returns the task.
func (c *Client) Comment(ctx context.Context, id, author, text string) (*Task, error) {
	return runJSON[Task](ctx, c, "comment", id, text, "--author", author, "--json")
}

// Delete removes a task and returns what it was.
func (c *Client) Delete(ctx context.Context, id string) (*Task, error) {
	return runJSON[Task](ctx, c, "delete", id, "--yes", "--json")
}

// Changes reports what happened since the named cursor last read, advancing
// it unless peek is set.
func (c *Client) Changes(ctx context.Context, cursor string, peek bool, ignoreAuthors ...string) (*Changes, error) {
	args := []string{"changes", "--as", cursor, "--json"}
	if peek {
		args = append(args, "--peek")
	}
	for _, a := range ignoreAuthors {
		args = append(args, "--ignore-author", a)
	}
	return runJSON[Changes](ctx, c, args...)
}

// Init creates a new todo file with todomd's default boards. It is a package
// function rather than a method because it runs before there is a file to
// build a client around.
func Init(ctx context.Context, bin, file string) error {
	if bin == "" {
		bin = DefaultBin
	}
	path, err := exec.LookPath(bin)
	if err != nil {
		return ErrNotInstalled
	}
	abs, err := filepath.Abs(file)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	c := &Client{Bin: path, File: abs}
	_, err = c.run(ctx, "init")
	return err
}
