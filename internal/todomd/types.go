// Package todomd is a client for the todomd command-line tool. Every read
// and write goes through a `todomd … --json` subprocess, so this package
// owns no knowledge of the TODO.md format: one implementation of the file
// format, one lock, one set of semantics, shared with whatever agent is
// driving the CLI at the same time.
package todomd

import "encoding/json"

// Comment is a dated note on a task, mirroring todomd's pinned JSON schema.
type Comment struct {
	Author string `json:"author"`
	Date   string `json:"date"`
	Text   string `json:"text"`
}

// Priority is "high", "normal" or "low". todomd always includes it, so
// nothing here has to infer the default.
type Priority = string

// Priorities, in the order todomd suggests working them.
const (
	PriorityHigh   Priority = "high"
	PriorityNormal Priority = "normal"
	PriorityLow    Priority = "low"
)

// Link is one of a task's links as todomd (v0.14.0 and newer) reports it,
// computed in both directions: Kind reads from this task's side ("blocked
// by" when the other card stores "blocks"), StoredOn names the card whose
// `#### Links` section holds the line. Title and Board are nil when the other
// card isn't on the board (archived or deleted).
type Link struct {
	Kind     string  `json:"kind"`
	ID       string  `json:"id"`
	Title    *string `json:"title"`
	Board    *string `json:"board"`
	StoredOn string  `json:"stored_on"`
}

// Task mirrors todomd's pinned task JSON schema.
type Task struct {
	ID          string    `json:"id"`
	Board       string    `json:"board"`
	Title       string    `json:"title"`
	Tags        []string  `json:"tags"`
	Priority    Priority  `json:"priority"`
	Due         *string   `json:"due"`
	Description string    `json:"description"`
	Comments    []Comment `json:"comments"`
	// Links is nil, and passed on as null, when todomd predates links
	// (v0.14.0); it is never nil from a todomd that has them, so the UI can
	// tell "no links" from "can't show links".
	Links []Link `json:"links"`
	// Sticker is the card's sticker (todomd v0.15.0 and newer). Its key is
	// left out when todomd predates stickers, and null when the card has
	// none, so the UI can tell "no sticker" from "can't show stickers".
	Sticker Sticker `json:"sticker,omitzero"`
}

// Sticker is a card's sticker as todomd reports it: a name such as "fire" or
// "red", or none. Present records whether todomd sent the field at all — an
// older todomd doesn't, and that has to survive the trip to the UI.
type Sticker struct {
	Name    string // "" for no sticker
	Present bool
}

// IsZero reports a sticker todomd didn't send, so `omitzero` leaves it out.
func (s Sticker) IsZero() bool { return !s.Present }

// MarshalJSON writes the name, or null for none.
func (s Sticker) MarshalJSON() ([]byte, error) {
	if s.Name == "" {
		return []byte("null"), nil
	}
	return json.Marshal(s.Name)
}

// UnmarshalJSON is only called when the key is there, null included.
func (s *Sticker) UnmarshalJSON(b []byte) error {
	var name *string
	if err := json.Unmarshal(b, &name); err != nil {
		return err
	}
	*s = Sticker{Present: true}
	if name != nil {
		s.Name = *name
	}
	return nil
}

// RemovedLink is one link `todomd links rm` took off a card.
type RemovedLink struct {
	StoredOn string `json:"stored_on"`
	Kind     string `json:"kind"`
	ID       string `json:"id"`
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

// DeletedBoard is what `todomd boards delete --json` reports: the board, and
// the tasks that went with it.
type DeletedBoard struct {
	Board string `json:"board"`
	Tasks []Task `json:"tasks"`
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
	Priority    Priority // "" leaves it at todomd's default, normal
	Due         string
}

// Update carries optional field changes; nil pointers mean "unchanged".
// An empty Tags slice (non-nil) clears all tags, an empty Due string
// (non-nil) clears the due date.
type Update struct {
	Title       *string
	Description *string
	Tags        *[]string
	Priority    *Priority
	Due         *string
	Sticker     *string // a name, or "" for none
}

// IsEmpty reports whether the update would change nothing.
func (u Update) IsEmpty() bool {
	return u.Title == nil && u.Description == nil && u.Tags == nil &&
		u.Priority == nil && u.Due == nil && u.Sticker == nil
}
