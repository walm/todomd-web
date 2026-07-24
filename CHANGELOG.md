# Changelog

## v0.1.0

First release. A Kanban web UI over a `TODO.md`, driving the `todomd` CLI for
every read and write.

- Board with columns, cards showing tags, due urgency and comment counts, and
  a text filter.
- Task detail — a dialog on a laptop, a bottom sheet on a phone — with
  rendered markdown, comments, inline editing, a board picker and delete.
  Deep-linked at `/t/<id>`.
- Drag-and-drop between and within columns, with optimistic moves.
- Unread badges from `todomd changes --as web`, so an agent's work shows up
  without polling; your own edits never badge.
- Syntax highlighting for fenced code, themed for light and dark. The markdown
  renderer loads on demand, keeping the board's first paint small.
- Single binary with the UI embedded, listening on localhost only.
