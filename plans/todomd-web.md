# todomd-web — plan

A single-binary web UI over a `TODO.md` file: Kanban board, task detail with
comments, editing, and drag-and-drop — usable from a phone. Companion to
[todomd](https://github.com/walm/todomd) (TUI + agent CLI), which stays the
tool agents drive, and which todomd-web itself shells out to for every read
and write. No file watcher, no realtime sync: this is the *human* front-end.

**Name:** `todomd-web` — repo, binary, and module
(`github.com/walm/todomd-web`). Sorts next to `todomd` in `~/.local/bin`, and
release assets parallel todomd's.

```sh
todomd-web                       # serve ./TODO.md on http://127.0.0.1:7337
todomd-web -f ../other/TODO.md --port 8080
```

---

## 1. Architecture

todomd-web owns no file logic. Every read and every mutation is a `todomd`
subprocess with `--json`; the Go server maps HTTP to CLI arguments and CLI
exit codes to HTTP statuses. **Both tools must be installed** — todomd-web
checks for `todomd` on PATH at startup and exits with an install hint if it
isn't there.

```
┌──────────────────────────────────────────────┐
│ todomd-web (single Go binary)                │
│                                              │
│  net/http ServeMux                           │
│   ├── /api/*   handlers ──► exec todomd …    │
│   └── /*       embedded SPA (embed.FS)       │
└───────────────────┬──────────────────────────┘
                    │ todomd -f <file> … --json
                    ▼
              todomd  ──►  flock, atomic write
                    │
                    ▼
                 TODO.md
```

Why shelling out is the right call here:

- **One implementation of the format.** No vendored parser to drift, no
  chance of todomd-web writing a file todomd would parse differently.
- **Locking and atomic writes come for free**, and they're the *same* lock:
  an agent running `todomd move …` while you drag a card serializes correctly.
- **Change tracking comes for free** — `todomd changes --as web --json` is
  exactly the "what happened since I last looked" feed the UI needs for
  unread badges, with no file watching.
- Cost is a process spawn per request (single-digit ms) on a localhost tool
  used by one person. Fine.

The only thing the server touches directly is `os.Stat` on the file, to
produce a `rev` (mtime+size) that lets the UI notice it's looking at stale
data.

**No in-memory state.** Every request re-reads through the CLI, so an agent
editing the file behind our back is a non-problem: the next request sees it.
Mutations are ID-based (`todomd update 3f2a --title …`), never whole-file
writes, so a stale browser tab can't erase an agent's concurrent edit.

**Staleness handling:** responses carry `rev`. The SPA refetches on window
focus / tab visibility and after every mutation — no polling loop, no watcher.

### CLI mapping

| Server operation | Subprocess |
|---|---|
| load board | `todomd -f F list --json` |
| one task | `todomd -f F show ID --json` |
| create | `todomd -f F add TITLE --board B --desc D --tag T… --due D --json` |
| edit | `todomd -f F update ID --title … --desc … --tag …/--clear-tags --due …/--clear-due --json` |
| move / reorder | `todomd -f F move ID --to B --pos N --json` |
| comment | `todomd -f F comment ID TEXT --author A --json` |
| delete | `todomd -f F delete ID --yes --json` |
| boards | `todomd -f F boards --json` |
| unread feed | `todomd -f F changes --as web --json` |

Exit codes map straight through: `2` → 404, `3` → 409, `1` → 400/500
(stderr becomes the error message). Every argument is passed as an argv
element — no shell, so titles and descriptions with quotes, newlines, or `$`
are safe by construction.

### Layout

```
todomd-web/
├── main.go
├── internal/
│   ├── todomd/            # CLI client: arg building, JSON decode, exit-code errors
│   │   ├── client.go  types.go  client_test.go
│   └── server/            # routing, handlers, error mapping, tests
│       ├── server.go  board.go  tasks.go  errors.go  server_test.go
├── web/                   # Vite app; also a Go package (embed.go)
│   ├── embed.go           # //go:embed all:dist
│   ├── index.html  vite.config.ts  package.json  tsconfig.json
│   ├── src/
│   │   ├── main.tsx  App.tsx
│   │   ├── api/           # typed client + TanStack Query hooks
│   │   ├── components/    # Board, Column, TaskCard, TaskSheet, forms
│   │   └── components/ui/ # shadcn/ui primitives
│   └── dist/              # built bundle (committed, see §4)
├── install.sh  .goreleaser.yaml  mise.toml
├── .github/workflows/{ci,release}.yml
└── README.md  CHANGELOG.md  LICENSE
```

---

## 2. HTTP API

JSON in, JSON out. The task shape is **todomd's pinned CLI schema**, passed
through unchanged — one schema for agents and the web UI:

```jsonc
{ "id": "3f2a", "board": "Backlog", "title": "…", "tags": ["core"],
  "due": "2026-08-01" /* or null */, "description": "…markdown…",
  "comments": [{ "author": "user", "date": "2026-07-24", "text": "…" }] }
```

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/config` | — | `{file, author, version, todomdVersion}` |
| GET | `/api/board` | — | `{file, rev, boards:[{name, tasks:[…]}]}` |
| GET | `/api/changes` | — | events since the `web` cursor last read (advances it) |
| POST | `/api/tasks` | `{board?, title, description?, tags?, due?}` | 201 + task |
| PATCH | `/api/tasks/{id}` | any of `{title, description, tags, due}` (`due:null` clears, `tags:[]` clears) | absent key = unchanged |
| POST | `/api/tasks/{id}/move` | `{to?, pos?}` | `pos` 1-based, omitted = append |
| POST | `/api/tasks/{id}/comments` | `{author, text}` | date is server-side today |
| DELETE | `/api/tasks/{id}` | — | 204 |

Mutation responses are `{task, rev}`. Errors are `{"error": "…"}`.

**Move semantics:** `todomd move --pos` inserts at `pos-1` in the
*post-removal* target list. dnd-kit's drop index means the same thing, so
`pos = dropIndex + 1` is correct in both directions and across columns.
Covered by a test table.

**Unread badges:** the UI reads `/api/changes` on load and on refocus and
keeps the resulting task IDs highlighted (added / updated / commented, like
the TUI's `●`/`○`) until you open the card. After each of *its own*
mutations the server silently advances the `web` cursor, so your own edits
never badge — only the agent's do.

**Comment authors:** the UI sends `author`, defaulting to the server's
`--author` flag (default `user`) and overridable per-browser in a settings
popover. Keeps your comments distinguishable from `ai`/`claude` ones, which
is what todomd's `--ignore-author` expects.

**Binding:** always `127.0.0.1`, no flag to change it. This endpoint writes
to your filesystem and has no authentication; it is a local tool. The README
will say so plainly, and point at `tailscale serve` (or an SSH tunnel) as
the way to reach it from a phone off-network — that puts identity and
transport security in a layer built for it rather than in a hand-rolled
token.

---

## 3. Frontend

**Stack:** React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui, TanStack
Query for server state, dnd-kit (`@dnd-kit/core` + `@dnd-kit/sortable`) for
drag-and-drop, react-markdown + remark-gfm + rehype-sanitize for descriptions
and comments (sanitized — the file may contain raw HTML), `vaul`-backed
shadcn Drawer for the mobile detail sheet.

**Board view** — columns in file order; cards show title, tag chips, a due
badge (overdue red / due-soon amber, like the TUI), comment count, and the
unread dot. Desktop: side-by-side columns. Mobile: full-width snap-scrolling
columns with a sticky header and dot indicator — one column at a time,
thumb-friendly.

**Task detail** — Dialog on desktop, bottom Drawer on mobile. Rendered
markdown description, comment thread, add-comment box, inline edit of
title/tags/due/description (`⌘/Ctrl+Enter` saves), board picker including
"new board…", delete with confirmation. Deep-linked at `/t/{id}`.

**Drag-and-drop** — dnd-kit with pointer + touch + keyboard sensors; touch
uses a short press-delay so vertical scrolling still works on a phone.
Optimistic reorder in the Query cache, `POST /move` behind it, rollback +
toast on failure. Because touch DnD is fiddly one-handed, the detail sheet's
board picker and a card long-press "move to →" menu are first-class
alternatives, not fallbacks.

**Also:** tag + text filter, dark mode following the system, toasts on every
mutation, empty/error/loading states, and `n` / `/` / `r` shortcuts on desktop.

---

## 4. Build & release

- `mise.toml` tasks: `build-web` (npm ci + vite build), `build` (build-web +
  `go build`), `dev` (Go server with `--dev` proxying to the Vite dev server
  for HMR), `test`.
- `web/embed.go`: `//go:embed all:dist`; SPA fallback to `index.html` for
  non-`/api` routes; immutable cache headers for hashed `/assets/*`,
  `no-cache` for `index.html`; gzip middleware.
- **`web/dist` is committed** so `go build` / `go install` work without Node;
  CI rebuilds it and fails if the committed output is stale.
- **goreleaser** mirroring todomd's: darwin/linux × amd64/arm64,
  `CGO_ENABLED=0`, version via ldflags, checksums, GitHub release.
- **install.sh** — todomd's, with `REPO=walm/todomd-web`:
  ```sh
  curl -fsSL https://raw.githubusercontent.com/walm/todomd-web/main/install.sh | sh
  ```
  README states the todomd prerequisite up front.
- **CI**: `gofmt -l`, `go vet`, `go test ./...` (with `todomd` installed for
  the integration tests), `tsc --noEmit`, `eslint`, `npm run build` + dist
  freshness check.

## 5. Tests

- **Go, hermetic:** a fake `todomd` on `PATH` (a test binary that records
  argv and replays canned JSON) covers argument construction, exit-code →
  status mapping, and the move-position table — no real file involved.
- **Go, integration:** the same endpoints against the real `todomd` binary
  and a temp `TODO.md`, skipped when `todomd` isn't on PATH.
- **Frontend:** vitest for the API client and DnD index math; Testing Library
  for the detail sheet. No e2e in v1.

---

## 6. Milestones

- [ ] **M1 — Skeleton.** Repo, module, mise, `internal/todomd` CLI client +
      tests, `GET /api/board` + `/api/config`. Verifiable with curl.
- [ ] **M2 — Read-only board.** Vite + Tailwind + shadcn scaffold, board /
      column / card components, mobile column snapping, dark mode, dev proxy.
- [ ] **M3 — Task detail & editing.** Detail dialog/drawer, markdown
      rendering, add/edit/delete task, add comment, board picker, and the
      matching write endpoints.
- [ ] **M4 — Drag-and-drop.** dnd-kit wiring, optimistic move/reorder, touch
      sensors, long-press "move to" menu.
- [ ] **M5 — Polish.** Unread badges off `/api/changes`, filters, keyboard
      shortcuts, toasts, empty/error states, refetch-on-focus.
- [ ] **M6 — Ship.** Embed + build pipeline, install.sh, goreleaser, CI,
      README (todomd prerequisite, localhost-only, tailscale serve for
      remote), v0.1.0 tag.

**Out of scope for v1:** editing/deleting existing comments (no CLI verb for
it), board rename/reorder (open upstream TODO), realtime updates, multi-file
browsing, accounts.

Possible later: PWA manifest for home-screen install on iOS, tag colours,
Done-column cleanup helpers.
