# Changelog

## Unreleased

- **Several projects at once.** Register todo files on the command line
  (`todomd-web a/TODO.md b/TODO.md`) or in
  `~/.config/todomd-web/config.json`, and switch between them from the header
  (`p`, or `1`–`9`). The switcher shows an unread count per project, so an
  agent working in a repo you are not looking at is visible without opening
  it. Projects can be added from the UI — including creating the file with
  `todomd init` — renamed, since names default to the folder and two repos
  with a `docs/` directory would otherwise be indistinguishable — and removed,
  which takes a project off the list without touching the file. There is no
  directory scanning.
- **Breaking (API):** board and task endpoints are now scoped by project, e.g.
  `/api/projects/{project}/board`. Deep links moved with them:
  `/p/{project}/t/{task}`; old `/t/{task}` links still open against the
  current project.

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
