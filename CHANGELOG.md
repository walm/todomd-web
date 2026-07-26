# Changelog

## v0.6.0

- **Priority**, following todomd v0.4.0: `high`, `normal` or `low`, marked on
  cards and rows as the TUI marks them and editable from both forms. `!high`
  or `priority:low` in the filter narrows to one priority, while a bare word
  still searches text — so "high" keeps finding a task called "High
  contrast". Needs todomd v0.4.0 or newer on every machine that touches the
  file.

## v0.5.0

- A **list view** (`v`, or the toggle in the header): every task in one
  column, grouped under its board, with sticky headings. A kanban board is
  wide by nature, which on a phone means scrolling sideways to see what is in
  progress. Drag-and-drop works the same in both views — a row dragged under
  another heading changes board exactly as a card does — and the choice is
  remembered per browser.
- An app icon: a favicon, and the PNGs iOS and Android want when the board is
  added to a home screen, plus a web app manifest so it opens standalone
  rather than in a tab, named **TodoMD**.
- Form fields no longer make iOS zoom the page. Safari zooms whenever a
  focused field is under 16px, and the zoom stayed — which threw off
  drag-and-drop and the bottom sheets afterwards; every field now stays 16px
  on phones and keeps its compact size on a desktop.

## v0.4.0

- **Projects over ssh.** A project can name a file on another machine —
  `todomd-web deploy@web1:/srv/app/TODO.md`, or the same scp syntax in the
  config file — and every read and write runs `todomd` there. The lock, the
  atomic write and the change cursor stay on the machine holding the file, so
  a board edit serializes with an agent working that file on the same host.
  Your ssh config is used as-is and no credentials are stored; connections are
  multiplexed, and `BatchMode` turns a host that wants a passphrase into a
  fast error rather than a hung request. A project may name its own `todomd`
  binary, which remote hosts often need because an ssh command runs a
  non-interactive shell.

## v0.3.0

- `todomd-web upgrade` installs the latest release over the running binary,
  with the same sha256 verification `install.sh` does — plus a check that the
  downloaded binary runs before it is swapped in. `--check` reports without
  installing, `--force` overrides the up-to-date and source-build guards,
  `--json` reports the outcome. A failed upgrade leaves the existing binary in
  place.
- An upgrade bar in the board, since a web UI is the kind of thing that stays
  open for weeks: it offers the changelog and an Upgrade button, which
  installs the release, restarts the server into it, and reloads the page.
  Dismissing it hides that version only. The check is cached and refreshed at
  most every six hours in the background; `TODOMD_WEB_NO_UPDATE_CHECK=1`
  disables it, and development builds neither nag nor upgrade.

## v0.2.1

- Flags typed after file arguments (`todomd-web a/TODO.md --port 8080`) were
  read as extra todo files and failed with a misleading "no TODO.md found".
  Arguments are now reordered before parsing.

## v0.2.0

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
