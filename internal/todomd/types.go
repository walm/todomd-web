// Package todomd is a client for the todomd command-line tool. Every read
// and write goes through a `todomd … --json` subprocess, so this package
// owns no knowledge of the TODO.md format: one implementation of the file
// format, one lock, one set of semantics, shared with whatever agent is
// driving the CLI at the same time.
package todomd

// Comment is a dated note on a task, mirroring todomd's pinned JSON schema.
type Comment struct {
	Author string `json:"author"`
	Date   string `json:"date"`
	Text   string `json:"text"`
}

// Task mirrors todomd's pinned task JSON schema.
type Task struct {
	ID          string    `json:"id"`
	Board       string    `json:"board"`
	Title       string    `json:"title"`
	Tags        []string  `json:"tags"`
	Due         *string   `json:"due"`
	Description string    `json:"description"`
	Comments    []Comment `json:"comments"`
}

// Board is a column of tasks.
type Board struct {
	Name  string `json:"name"`
	Tasks []Task `json:"tasks"`
}

// File is the whole board as returned by `todomd list --json`.
type File struct {
	Path   string  `json:"file"`
	Boards []Board `json:"boards"`
}

// BoardCount is one entry of `todomd boards --json`.
type BoardCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// FieldChange is the old/new pair for one changed task field.
type FieldChange struct {
	Old any `json:"old"`
	New any `json:"new"`
}

// Event is one semantic change reported by `todomd changes --json`.
type Event struct {
	Type    string                 `json:"type"`
	TaskID  string                 `json:"task"`
	Title   string                 `json:"title"`
	Board   string                 `json:"board"`
	From    string                 `json:"from,omitempty"`
	To      string                 `json:"to,omitempty"`
	Fields  map[string]FieldChange `json:"fields,omitempty"`
	Comment *Comment               `json:"comment,omitempty"`
	Detail  *Task                  `json:"detail,omitempty"`
}

// Event types reported by todomd.
const (
	TaskAdded    = "task_added"
	TaskDeleted  = "task_deleted"
	TaskMoved    = "task_moved"
	TaskUpdated  = "task_updated"
	CommentAdded = "comment_added"
)

// Changes is the result of `todomd changes --json`.
type Changes struct {
	File        string  `json:"file"`
	Cursor      string  `json:"cursor"`
	Initialized bool    `json:"initialized"`
	Events      []Event `json:"events"`
}

// NewTask carries the fields of a task being created.
type NewTask struct {
	Board       string
	Title       string
	Description string
	Tags        []string
	Due         string
}

// Update carries optional field changes; nil pointers mean "unchanged".
// An empty Tags slice (non-nil) clears all tags, an empty Due string
// (non-nil) clears the due date.
type Update struct {
	Title       *string
	Description *string
	Tags        *[]string
	Due         *string
}

// IsEmpty reports whether the update would change nothing.
func (u Update) IsEmpty() bool {
	return u.Title == nil && u.Description == nil && u.Tags == nil && u.Due == nil
}
