# Changelog

## v0.16.1

- **A new icon.** A stack of three cards, the front one with the Markdown
  mark and a tick, in neutral greys: the same icon as the todomd CLI. The
  favicon and the home-screen and install icon are now one drawing, and it
  is the README logo too.

## v0.16.0

- **Card stickers.** A card can carry one sticker, as on todomd.online: an
  emoji (🔥 ⭐ 👀 🚧 ✅ 🎯 ⚡ 💡 🐛 🚀 ❓ ❤️) sticking out over its top-right
  corner, or a red, amber, green, blue or violet ribbon across it, on board
  cards and list rows alike. An open card shows it as a chip next to the
  board select (a quiet **Sticker** when there is none). Set it without
  opening the card: click the sticker or the ☺+ that shows on hover, press
  `s` on the card under the pointer or the one with focus, or long-press a
  card on a phone for a bottom sheet. The picker takes `1`–`9` for the first
  nine emoji and `0` for none. Everything goes through `todomd update
  --sticker`, so the file reads back exactly as the CLI writes it
  (`<!-- sticker: fire -->`). The filter takes `sticker:fire`, `sticker:🔥`,
  `sticker:red`, `has:sticker` (or `sticker:any`) and `sticker:none`. Needs
  todomd v0.15.0; with an older one the board shows no stickers and the
  open card says to upgrade.

## v0.15.0

- **Card links.** An open card has a **Links** section under the
  description: split from/into, blocks/blocked by, related and duplicate
  links, both ways, with the other card's id, title and board (done cards
  struck through, "blocked by" an open card in amber). Below them,
  **Mentioned in** lists the cards whose text names this one, each with
  **Make link**. **Link a card** opens a picker — kind chips, a search by
  title or id, the cards this one mentions first — as a popover driven by
  the keys on a laptop and a bottom sheet on a phone; × removes a link
  wherever it is stored. Everything goes through `todomd links add|rm`, so
  the file reads back exactly as the CLI writes it (`- blocks 9e41` under
  `#### Links`). Board cards and list rows show a link count and an amber
  **blocked** mark, and the filter takes `is:blocked` and `link:9e41`.
  Needs todomd v0.14.0; with an older one the card says to upgrade and
  nothing else changes.

## v0.14.1

- **A new icon.** Three grey glass lanes with the Markdown mark and a tick on
  the front one, the same icon as the todomd CLI. It is the home-screen and
  install icon and the README logo; the favicon is a stack of three cards,
  the front one ticked, drawn to stay legible at 16 px. A `favicon.ico`
  joins the SVG for browsers that ask for one, and installs get a real
  maskable icon instead of the regular one cropped.

## v0.14.0

- **A simpler "Connect an agent".** The only thing to run yourself is
  getting todomd v0.13.0 or newer; then start your agent in the file's
  folder with a short prompt that has it run `todomd skill` (or
  `todomd skill --install`) first, then `todomd watch` in a loop, acting on
  the events by your rules. The rules keep their own section to edit, with the board's real
  names. `todomd watch` also syncs a board linked to todomd.online both
  ways, so an agent no longer misses your online changes, and there is no
  `todomd sync --watch` to keep running next to it. The dialog shows
  `todomd login` (once per machine) and `todomd link` only as an optional
  line for todomd.online; a local board needs neither.

## v0.13.0

- **What to look at, across projects.** The project switcher counts, per
  project, the cards that changed since you last looked — green if any is
  new, amber if they are only changed, the same colours as the card badges —
  and the switcher button shows the total for the other projects (the open
  board keeps its own unread count). Your own edits don't count. The other
  projects are peeked at with `todomd changes --peek` on load and on focus,
  not on a timer, so counting no longer takes their changes: opening one
  badges every card, in this browser or another. A slow project over ssh
  only leaves its own count missing for a while.

## v0.12.0

- **Connect an agent.** A button in the header, and a banner you can dismiss,
  open a ready-made prompt for a coding agent to work the board: it watches
  the project's `TODO.md` with `todomd changes --wait`, answers new cards,
  starts on GO and moves cards to Done, with the rules in a section of their
  own to edit. The prompt uses the board's real file path and board names,
  and for a project over ssh says to run the agent on that host. No login or
  sync involved. Needs todomd v0.10.0 or newer where the agent runs.

## v0.11.0

- **Images synced with todomd.online show on the board.** For a todo file
  linked to a todomd.online project, the images `todomd sync` keeps — attached
  with `todomd attach` or pasted on the online board — display inline, served
  from the folder todomd reports. Needs a todomd with sync.

## v0.10.0

- **Copy a code block** with the button in its top-right corner, shown on
  hover in a task's description or comments — and always on touch screens.

## v0.9.0

- **Attachments.** Paste a screenshot into a task's description or comment
  box, drop a file on it, or pick one with the paperclip — while writing a
  new task too. The file is linked from `TODO.md` by its absolute path, so an
  agent reading the file can open it, and kept under
  `$XDG_STATE_HOME/todomd-web/attachments`, never in the repository. Images
  show inline; everything else downloads. Attachments go with their task,
  however it is deleted — here, by an agent, from the TUI or by a `git pull`.
  Up to 25 MB a file; projects over ssh cannot take attachments yet.

## v0.8.0

- **Delete a board** from its heading, following todomd v0.9.0. An empty board
  goes on the click; one that still holds tasks asks first and says how many,
  because todomd deletes those tasks with it. Available in both views, and
  needs todomd v0.9.0 or newer.

## v0.7.1

- The open task keeps its board picker, priority, due date, tags and Edit
  button pinned beside the title, instead of scrolling them away behind a
  long description or comment thread. They sit outside the scrolling area in
  both the desktop dialog and the mobile sheet.

## v0.7.0

- **An open board now refreshes itself** — every 10 seconds for a local
  project, 30 for one over ssh — so an agent's work turns up on a screen
  nobody is touching. Previously it re-read only when the window regained
  focus, which missed exactly that case. The timer stops while the tab is in
  the background; set it with `--poll 30s`, or in the config file globally or
  per project; `--poll 0` switches it off.

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
