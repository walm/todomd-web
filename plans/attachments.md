# Attachments — plan

A card today can say "the header overlaps on iOS"; it cannot show it. This
adds files to a task — a screenshot pasted from the clipboard, a log, a
markdown snippet — as **links in the todo file**, with the bytes kept outside
the repository and thrown away when the task is.

Three constraints shape everything below:

- **The file stays the interface.** An attachment is an ordinary markdown
  link in a description or a comment. Nothing new appears in the format, and
  `todomd` neither knows nor cares that we did this.
- **Nothing lands in the repository.** No sidecar directory to `.gitignore`,
  no accidental `git add -A` of a 4 MB screenshot.
- **The bytes die with the card.** Delete the task — from the web UI, the
  TUI, an agent, or a `git pull` that removed it — and the files go too.

The use that justifies it: paste a screenshot onto a card, and the agent
working that file can open the path it reads in `TODO.md` and look at it.
That is only true if the link is something an agent can resolve on its own,
which decides §0.2 below.

---

## 0. Decisions

All four are settled; the alternatives are kept because they are the ones
worth re-opening if something below turns out to hurt.

### 0.1 Where the bytes live — the state directory

| Option | Path | Verdict |
|---|---|---|
| **State dir** | `$XDG_STATE_HOME/todomd-web/attachments/<file-key>/<task>/<name>` | **yes** |
| Sidecar in the repo | `<dir of TODO.md>/.todomd/attachments/…`, self-ignoring | no |
| Committed to the repo | — | ruled out by the brief |

todomd already made this call for us. `internal/statedir` says it in one
line: *"Lock files and change cursors live here so repositories stay free of
sidecar files."* Locks and cursors are keyed by a hash of the todo file's
absolute path under `$XDG_STATE_HOME/todomd/<hash>`; attachments follow the
same recipe under our own `todomd-web/` tree.

The sidecar option buys prettier, relative links (`.todomd/attachments/…`)
that survive moving the repo — at the cost of writing into someone's working
tree and relying on a nested `.gitignore` holding `*` to keep it out of
commits. Writing files nobody asked for into a git repo is exactly the
surprise this project avoids elsewhere ("there is no directory scanning:
paths are typed once, by you").

Keying by the **todo file's absolute path**, not by project id, matters:
renaming a project changes its id, and links written yesterday must keep
working. Remote projects hash the full address, `deploy@web1:/srv/app/TODO.md`.

### 0.2 What the link says — an absolute path

```markdown
![header overlaps on iOS](/Users/walm/.local/state/todomd-web/attachments/9c1fa3b2d4e5f607/3f2a/header-ios.png)
```

| Option | Reads as | Verdict |
|---|---|---|
| **Absolute path** | `![shot](/Users/…/attachments/9c1f…/3f2a/shot.png)` | **yes** |
| `attachment:` scheme | `![shot](attachment:3f2a/shot.png)` | no |
| `http://127.0.0.1:7337/…` | a URL that dies with the port | no |
| `file://…` URL | same length, worse tooling | no |

An absolute path is the only form an agent can act on without being taught
anything: `Read /Users/…/header-ios.png` just works, which is the whole point
of the feature. A custom scheme is prettier in the file and portable between
machines, but it is legible to exactly one program — todomd-web — and the
file is meant to be readable by everything.

The path is long. That is the honest cost, and it is paid in a link whose
text is the filename you chose.

Escaping: wrap the target in angle brackets when it contains spaces or
parentheses — `![shot](</Users/Jane Smith/…/shot.png>)` — and escape `]` in
the link text.

### 0.3 Who writes the link — the editor, not the server

Upload returns the markdown; the **UI inserts it at the caret** in the
description editor or the comment box, and the file is written by the
ordinary `PATCH /tasks/{id}` or comment call.

The alternative — upload appends to the description server-side — costs a
second kind of write to the todo file and makes an abandoned paste a
permanent edit. Keeping the write task-shaped preserves the invariant the
README states: *every write is expressed as a task id, never as a whole-file
save*. The cost is that an upload abandoned before saving leaves a file
nobody references; §5 sweeps those up when the task dies.

### 0.4 Projects over ssh — local-only for v1

The store lives on the machine running todomd-web. For a project whose file
is on another host, an absolute path written into that file points at a
directory the remote agent does not have — a link that lies.

So: **v1 disables attaching on remote projects** (the paperclip is hidden,
the drop zone says why), and a later phase adds the honest version — stream the
file over the existing multiplexed ssh connection into the remote host's own
`$XDG_STATE_HOME/todomd-web/attachments/…`, and read it back the same way,
so the link is true for the agent working there.

### 0.5 Lifetime — as long as the task

An attachment lives while its task does. Removing the link from a
description does **not** delete the file: link text is edited constantly, and
racing a half-finished edit to delete someone's screenshot is a bad trade.
Unreferenced files go when their task's directory does.

---

## 1. Storage layout

```
$XDG_STATE_HOME/todomd-web/attachments/       (~/.local/state when unset)
└── 9c1fa3b2d4e5f607/          hex(sha256(abs todo file path)[:8])
    └── 3f2a/                  task id
        ├── header-ios.png
        └── server-log-2.txt   deduped: a second server-log.txt
```

Directories `0o700`, files `0o600`: this is a private cache of things
somebody pasted, not a share.

`internal/attach` owns the whole tree. Nothing else joins paths into it.

```go
package attach

func DefaultRoot() (string, error)        // …/todomd-web/attachments
func New(root string) *Store

func (s *Store) Root(file string) string  // per-file root
func (s *Store) Save(file, task, name string, r io.Reader, max int64) (Saved, error)
func (s *Store) Open(file, task, name string) (*os.File, fs.FileInfo, error)
func (s *Store) RemoveFile(file, task, name string)   // undo a failed upload
func (s *Store) RemoveTask(file, task string) error
func (s *Store) Sweep(file string, live map[string]bool) ([]string, error)   // see §5
```

`Saved` carries `{Name, Path, Size, Type, Markdown}` — the link is built
here, next to the escaping rules it depends on, so the UI only inserts it.

Names are sanitised to a base name: path separators and `..` dropped, control
characters and leading dots stripped, length capped at 100, empty results
become `file`, and an existing name gets `-2`, `-3` before the extension.
Task ids are checked against `^[0-9a-z]{1,32}$` (todomd's are four of those)
before they become a path segment.

## 2. HTTP API

Two routes, in the shape the rest of the API already has — every path names
its project.

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/projects/{project}/tasks/{id}/attachments` | `multipart/form-data`, one or more `file` parts → `{attachments: [{name, path, markdown, size, type}]}` |
| `GET` | `/api/projects/{project}/attachments/{task}/{name}` | — the bytes |

`GET /api/projects` gains `attachments` per project: the absolute per-file
root, so the UI can recognise its own links without guessing, and absent for
a project that cannot take attachments. `GET /api/config` gains
`attachmentMaxBytes`, so the UI refuses a too-large file before uploading it.

Errors keep the existing vocabulary: `404` unknown project/task/file, `413`
over the size cap, `400` a malformed multipart or an unusable name, `409`
never.

## 3. Server work

**`internal/attach/`** (new, ~200 lines + tests) — §1, plus `Sweep`.

**`internal/server/attachments.go`** (new, ~150 lines):

- `handleUploadAttachment` — refuse remote projects; verify the task exists
  (`client.Show`, so an upload to a deleted card fails loudly rather than
  creating a directory the sweep will collect, and a prefix resolves to the
  id); stream the parts with `r.MultipartReader` straight into the store, so
  nothing is buffered in memory or a temp file; cap the body with
  `http.MaxBytesReader` and each file in `Save`; all or nothing — a failed
  part removes the ones before it; return the markdown.
- `handleServeAttachment` — resolve through the store only, never from the
  URL; `http.ServeContent` for range requests and ETag; headers per §6.

**`internal/server/server.go`** — two `route(…)` lines, a `store` field on
`Server`, `Options.Attachments` (nil means the default under
`$XDG_STATE_HOME`) and `Options.MaxAttachment`.

**Cleanup hooks** — `handleDeleteTask` and `handleDeleteBoard` call
`RemoveTask` for every task that went; `handleChanges` calls it for each
`task_deleted` event it sees, which is how deletions by an agent, the TUI or
a `git pull` are caught; `handleBoard` triggers a throttled sweep (§5).

Failing cleanup is logged, never fatal: a leftover file is not worth a failed
delete.

## 4. UI work

**`web/src/lib/attach.ts`** — pure and unit-testable:
`insertSnippet(text, start, end, snippet)`, which puts the link on a line of
its own and returns the new text and caret; `attachmentUrl`, the transform
below; and `formatBytes` for the too-large message.

**`useAttach`** in `web/src/api/hooks.ts` — the upload mutation, toasting on
failure like its neighbours, and invalidating nothing, since an upload leaves
the board as it was.

**`web/src/components/attach-field.tsx`** — a wrapper around `Textarea` that
adds the three ways a file arrives:

- **Paste** — `onPaste`, `e.clipboardData.files`. This is the one that
  matters: ⌘⇧4 then ⌘V onto a card.
- **Drop** — `onDragOver`/`onDrop` on the textarea, with a dashed ring while
  a file is over it. Native file drags do not touch dnd-kit's pointer
  sensors, and the task dialog is modal, so there is no interaction with
  board dragging.
- **A paperclip button** with a hidden `<input type="file" multiple>` —
  the only route on a phone, where it also offers the camera.

While a file uploads, a row under the box names it with a spinner; on
success the markdown is inserted at the caret and the caret lands after it;
on failure the row turns into a message and nothing is inserted. Save is
disabled while an upload is in flight, so a description cannot be saved
referring to a file that did not land.

Used in two places: the description `Textarea` in `TaskFields`, and the
comment box in `Comments` — both in `task-detail.tsx`.

**Rendering** — `Markdown` takes the project's attachment root and passes
react-markdown a `urlTransform`:

- a URL under the project's attachment root → `/api/projects/{id}/attachments/{task}/{name}`
  (compared after decoding, since the markdown pipeline percent-encodes
  spaces and non-ASCII first);
- everything else → react-markdown's default transform, which drops unsafe
  protocols such as `file:` and `javascript:`. Another absolute path passes
  through and shows as a broken image: telling `/Users/…` from an app route
  such as `/t/3f2a` is guesswork, and a visible miss beats a silent one.

The transform runs after `rehype-sanitize`, on URLs that already passed it.

Images get `max-w-full rounded-md border` and open in a new tab on click;
non-images render as an ordinary link that downloads. A lightbox is not in
v1.

The board is untouched — cards show no previews, and `markdown-lazy` keeps
the parser off the board's first paint.

## 5. Garbage collection

`Sweep(file, live)` lists the per-file root, and removes every directory
whose name is not in `live`. Three guards, each earning its place:

- **Never sweep on a failed read.** The live set comes from a successful
  `todomd list`; an ssh timeout or a parse error means no sweep, not an empty
  live set.
- **Skip directories touched in the last 10 minutes**, so an upload that
  raced a board read taken before the task existed is not collected.
- **Never leave the root.** Entries are matched against the task-id shape
  and joined by the store; symlinks are not followed.

It runs when a board is read and that project has not been swept for 10
minutes, at most one at a time per file. It runs inline: it is one
`ReadDir` of a directory with a handful of entries, which is not worth a
goroutine outliving its request.

Direct removal (`RemoveTask`) covers the common cases immediately; the sweep
is the net under everything else, including a task deleted while no browser
was open.

### 5.1 Attaching while writing a new task

The new-task dialog has no task id — todomd assigns one on `add`, and has no
flag to take one — so its uploads go to a **draft**: the browser picks a
random id, `POST /drafts/{draft}/attachments` stores under
`<root>/_drafts/<draft>/`, and the links are inserted as usual. Creating the
task with `draft` set then:

1. adds the task, description and draft links as written;
2. hard-links the draft's files into the task's directory, so both paths
   resolve;
3. rewrites the draft directory to the task's in the description — a second
   write, and an unavoidable one, since the final path is not known before
   the task exists;
4. removes the draft.

No step fails the create: the task is already in the file, and an error would
invite a duplicate. If the rewrite fails, the task's copies go and the links
keep pointing at the draft, which still holds the files.

The `_` keeps the drafts directory from ever reading as a task id. An
unclaimed draft is swept after a day rather than ten minutes, so a dialog left
open over lunch keeps its screenshot.

## 6. Security

The README is blunt about the posture — localhost only, no auth, "a
shell-adjacent capability" if published — and this feature writes files and
serves them back, so:

- **The URL never becomes a path.** `{task}` and `{name}` are validated and
  joined by the store; `..`, separators and absolute names are rejected
  before any filesystem call. A request for something outside the root is a
  `404`, not a `403` — it is not there as far as this API is concerned.
- **Served inert.** `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: default-src 'none'; sandbox`, `Content-Type` from
  the extension only (never the client's claim), and `Content-Disposition:
  attachment` for everything outside a small inline allowlist (png, jpeg,
  gif, webp, avif, svg, pdf, txt, md). SVG is fine inline in an `<img>` — it
  cannot run script there — and the CSP covers a direct visit.
- **Bounded.** 25 MB per file by default via `http.MaxBytesReader`, 10 files
  per request; a partial write is removed. No total quota in v1 — the store
  is per todo file and dies with the tasks; a `du`-shaped answer can come
  later if anyone wants one.
- **Uploads need an existing task**, so the tree cannot be seeded with
  directories for ids that will never exist.

## 7. Tests

Go (`internal/attach`): name sanitising, including `../../etc/passwd`,
`C:\x`, unicode, empty, 300 chars, and the dedupe sequence; key derivation
stable across renames and different per file; `Sweep` keeps live dirs,
removes dead ones, skips fresh ones, and refuses to escape the root.

Go (`internal/server`): upload → file on disk with the expected bytes and a
markdown string that resolves back through the GET route; upload to an
unknown task → 404; oversize → 413; upload to a remote project → 400 with a
message that says why; GET of a traversal path → 404; delete task and delete
board remove the directories; a `task_deleted` event in `/api/changes`
removes one.

Go also covers the markdown builder (image vs file, spaces, `]` in the name,
angle brackets). Vitest: `insertSnippet`, and the `attachmentUrl` mapping
(root → API route, percent-encoded input, a sibling directory that merely
shares the prefix, unsafe protocols dropped, http untouched).

## 8. Docs

- **README** — a "📎 Attachments" section after the board section: paste,
  drop or pick; where the bytes live and that they are never in the repo;
  that the link is an absolute path an agent can open; that they go when the
  task does; that ssh projects cannot attach yet. Two rows in the API table,
  and a sentence in the security section.
- **CHANGELOG** — an entry under `## Unreleased`, which the release's
  "Prepare the changelog" commit renames to the version.
- **`docs/demo/`** — worth a later pass: pasting a screenshot onto a card is
  the most demo-able thing this project has.

## 9. Build order

| Phase | What | Rough size |
|---|---|---|
| 1 | `internal/attach` + tests | ~350 lines |
| 2 | Upload and serve routes, options, project/config fields + tests | ~350 lines |
| 3 | UI: `attach.ts`, `useAttach`, `attach-field`, wired into description and comments | ~250 lines |
| 4 | Rendering: `urlTransform`, image styles | ~60 lines |
| 5 | Cleanup: delete hooks, `task_deleted`, throttled sweep + tests | ~200 lines |
| 6 | README, `mise run build-web` and commit `web/dist` | — |

Phases 1–2 are usable from `curl` alone; 3–4 make it a feature; 5 is what
keeps the disk honest. Each is a commit that stands on its own.

## 10. Not in v1

- **Attachments over ssh** (§0.4) — the phase that makes remote projects
  first-class.
- **Deleting one attachment from the UI** — removing the link is what people
  will do; the file goes with the task.
- **Rendering repo-relative images** (`![](docs/demo.gif)` in a description)
  — a natural neighbour, but it turns the server into a read-only file server
  for the project directory, which deserves its own decision.
- **A quota or an age-based purge.**
