# Multiple projects — plan

Today `todomd-web` serves exactly one `TODO.md`, fixed at startup. This adds a
project switcher: several todo files registered with the server, one board
shown at a time, and — the part that makes it worth doing — a visible sign of
which *other* projects an agent has touched since you last looked.

Nothing about the single-file case should get heavier: `todomd-web` in a
project directory must keep working exactly as it does now, with no switcher
in sight.

---

## 0. Decisions to confirm

### 0.1 Where the project list comes from — recommend "flags + a config file"

| Source | Example | Verdict |
|---|---|---|
| **Positional args** | `todomd-web ~/src/a/TODO.md ~/src/b/TODO.md` | yes — the zero-setup way to try it |
| **Config file** | `~/.config/todomd-web/config.json` | yes — the durable list, and what the UI edits |
| **Implicit discovery** | today's behaviour when nothing is given | unchanged |

Precedence: positional args (and `--file`) win and, when given, are the whole
list; otherwise the config file; otherwise today's single-file discovery.
There is deliberately **no directory scanning** — a tool that goes hunting
through your home directory for files to write to is a surprise nobody asked
for, and typing the paths once is cheap.

Config format is **JSON** — the stdlib reads it and this repo has no
dependencies today; TOML would cost one for a file with three fields.

```jsonc
{
  "projects": [
    { "name": "todomd",     "file": "/Users/walm/src/todomd/TODO.md" },
    { "name": "todomd-web", "file": "/Users/walm/src/todomd-web/TODO.md" },
    { "name": "house",      "file": "/Users/walm/notes/house/TODO.md" }
  ]
}
```

`name` is optional; it defaults to the *directory* name, because every file is
called `TODO.md`. (`todomd list --json` does not report the file's `# Title`,
so we cannot use that without an upstream change — worth asking for later,
not worth blocking on.)

### 0.2 API shape — recommend path-scoped, and accept the break

Every board/task route gains a project segment:

```
GET    /api/projects
GET    /api/projects/{project}/board
POST   /api/projects/{project}/tasks
PATCH  /api/projects/{project}/tasks/{id}
…
```

The alternative — `?project=` on today's routes — keeps the old URLs working
but leaves the "which file?" question in a query string that is easy to drop.
Path-scoping makes every request unambiguous and the handlers stay as thin as
they are now.

This **breaks the current API**, which is fine at 0.x (todomd's own convention:
minor bumps may break, called out in the changelog) and there are no other
consumers yet. I'd rather not carry unprefixed aliases: they double the route
table and quietly encode "there is a current project" server-side, which is
the statefulness this design is trying to avoid.

### 0.3 Project ids — recommend slugs, not hashes

`/p/todomd-web/t/3f2a` reads better than `/p/9f2c1a/t/3f2a` and survives being
pasted into chat. Slug from the name (lowercased, non-alphanumerics to `-`),
deduped with a numeric suffix when two directories collide (`docs`, `docs-2`).
Ids are stable as long as the config is; renaming a project changes its URL,
which is acceptable for a bookmark-scale feature.

### 0.4 Adding projects from the UI — recommend yes, with narrow rules

The switcher gets "Add project…" (type or paste a path) and "Remove". Adding
writes to the config file. Rules, because this is a browser telling a server
to touch arbitrary paths on your disk:

- the path must resolve to an existing regular file ending in `.md`, **or**
- it may name a directory or a non-existent `TODO.md`, in which case the UI
  offers "create it" and the server runs `todomd init` — nothing else;
- paths are stored absolute, deduped by resolved path;
- removal only edits the config; it never deletes a file, and the UI says so
  where you click it ("Removes it from this list. The file stays where it
  is.") — nobody should have to guess whether a "Remove" button is about to
  delete their todo list.

This stays localhost-only and single-user, so the exposure is what it already
was. If you would rather the server never write config on the UI's say-so, a
`--no-config-writes` flag can make the list read-only — say the word and it
goes in.

### 0.5 Unread across projects — recommend on-demand, capped

`todomd changes --as web` is per-file (todomd keys its state dir by the file's
path), so each project already has an independent cursor — no new mechanism,
just N invocations. Reading a project's feed *consumes* its events, so the
counts live in the browser (localStorage, keyed by project id), exactly as
today's per-task badges do.

Polling every project on every window focus would spawn N subprocesses each
time. Recommend: refresh the current project's feed as today, and refresh
*all* projects' feeds on load and when the switcher opens, capped at 4
concurrent and skipped for projects whose file is missing.

---

## 1. Server changes

```
internal/todomd/client.go     unchanged — it is already per-file
internal/project/registry.go  NEW: config load/save, slugs, resolution
internal/server/server.go     holds a registry, resolves {project} per request
internal/server/projects.go   NEW: list/add/remove endpoints
```

- `Server` gains `registry *project.Registry` and keeps a `map[slug]*todomd.Client`
  built lazily. `self` (the "this server made this change" set that stops your
  own edits badging) becomes per-project.
- A `withProject` helper resolves `{project}` once and 404s with
  `{"error":"no such project"}` — the same shape as every other error today.
- `/api/config` keeps reporting the server-wide bits (author, versions) and
  loses `file`, which is now per project.

### New endpoints

| Method | Path | Body / notes |
|---|---|---|
| `GET` | `/api/projects` | `[{id, name, file, available, error?}]` — `available:false` for a file that has moved or no longer parses, so the switcher can show it greyed rather than breaking the board |
| `POST` | `/api/projects` | `{file, name?, create?}` — `create:true` runs `todomd init` |
| `DELETE` | `/api/projects/{id}` | drops it from the config; never touches the file |
| `GET` | `/api/projects/{id}/changes` | as today, per project |

Everything else is today's route with `/api/projects/{id}` in front.

## 2. Frontend changes

- **Switcher in the header**, left of the filter: current project name, click
  for a list with per-project unread dots, "Add project…", and a "Manage"
  affordance for removal. Native `<select>` will not do here — the list needs
  badges and actions — so it is a popover on desktop and a bottom sheet on
  mobile, matching how task detail already adapts.
- **Routing**: `/p/{project}` and `/p/{project}/t/{id}`. A bare `/` redirects
  to the last used project (localStorage) or the first one. Old `/t/{id}`
  links resolve against the default project so existing bookmarks survive.
- **Query keys** become `['board', projectId]` etc., so switching projects is
  a cache hit after the first visit and each board refetches independently.
- **Unread store** moves from `{taskId: kind}` to `{projectId: {taskId: kind}}`;
  a migration on read keeps existing marks (treat a bare map as the default
  project's).
- **Keyboard**: `p` opens the switcher; `1`–`9` jump to the first nine
  projects. Both no-ops when there is only one.
- **Single project**: the switcher renders as a plain, non-interactive title —
  no menu, no dots — so the common case looks like it does today.

## 3. Edge cases worth naming

- A configured file that has been deleted, moved, or made unparseable shows as
  unavailable in the switcher with todomd's own message, and opening it shows
  the same error the board shows today — the other projects keep working.
- Two entries pointing at the same resolved path are deduped on load.
- A project removed while it is open sends you to the first remaining one.
- The config file being hand-edited while the server runs is fine: it is read
  per request, like everything else here.
- No file at all (empty config, no discovery): the board shows an empty state
  with "Add project…" rather than the fatal startup error we have today.

## 4. Tests

- **Registry**: slug generation and dedupe, config round trip, precedence
  (args > config > discovery), scan depth and skips, add/remove.
- **Server**: routes resolve the right file (two temp projects, assert a task
  created in one is invisible in the other); unknown project → 404; per-project
  change cursors stay independent; `self`-suppression does not leak across
  projects.
- **Frontend**: unread-store migration, URL parsing for `/p/x/t/y`.

## 5. Milestones

- [ ] **M1 — Registry and API.** Config, slugs, resolution, path-scoped
      routes, `/api/projects`, tests. Verifiable with curl.
- [ ] **M2 — Switcher and routing.** Header switcher, `/p/{id}` routes,
      per-project query keys and unread store. *Review point.*
- [ ] **M3 — Managing projects.** Add (with `todomd init` for new files),
      remove, unavailable states, empty state.
- [ ] **M4 — Cross-project unread.** Capped parallel change feeds, dots in the
      switcher, `p` and `1`–`9`.
- [ ] **M5 — Ship.** README (flags, config file, the API break), CHANGELOG,
      re-record the demo gifs so the switcher is visible, tag v0.2.0.

Rough size: M1 and M2 are the bulk (a day-ish of work each at this pace); M3–M5
are smaller. The whole thing is additive to the Go side — no change to how a
single board reads or writes, so the risk sits almost entirely in the frontend
state reshuffle.

## 6. Out of scope for this change

- Cross-project search or a combined "everything due this week" view. Tempting,
  and much easier once the registry exists — but it is a different feature.
- Per-project settings (author, theme).
- Reordering or grouping projects beyond config order.
- Anything that watches the filesystem.
