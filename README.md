<h1 align="center">todomd-web</h1>

<p align="center">
  A Kanban web UI for <a href="https://github.com/walm/todomd">todomd</a> —
  one Go binary, no database, your <code>TODO.md</code> is still the truth.
</p>

todomd gives agents a CLI and you a TUI. todomd-web adds the third way in:
a board you can open on a laptop or a phone, tap a card, read the agent's
comments, reply, edit and drag things around — while the agent keeps working
through the same file.

It shells out to `todomd` for **every** read and write, so there is exactly
one implementation of the file format, one lock, and one set of semantics.
Nothing here parses your markdown.

## 📦 Install

Both binaries are needed — todomd does the work, todomd-web puts a screen on
it:

```sh
curl -fsSL https://raw.githubusercontent.com/walm/todomd/main/install.sh | sh
curl -fsSL https://raw.githubusercontent.com/walm/todomd-web/main/install.sh | sh
```

Or build from source (Go 1.26+; the UI bundle is committed, so no Node
needed):

```sh
go install github.com/walm/todomd-web@latest
```

## 🚀 Use

```sh
cd your-project
todomd-web                 # serves ./TODO.md on http://127.0.0.1:7337
todomd-web --open          # …and opens a browser
todomd-web -f ~/notes/TODO.md --port 8080 --author andreas
```

| Flag | Default | What it does |
|---|---|---|
| `-f`, `--file` | todomd's discovery | Path to the todo file (else `TODOMD_FILE`, else `TODO.md` searched upward) |
| `--port` | `7337` | Port on localhost |
| `--author` | `user` | Default author recorded on comments you write |
| `--todomd` | `todomd` | Path to the todomd binary |
| `--open` | off | Open the board in your browser |
| `--dev` | — | Proxy the UI to a Vite dev server, e.g. `http://127.0.0.1:5173` |

On the board: click a card to open it, `n` for a new task, `/` to filter,
`r` to reload. Drag cards between columns or up and down; on a phone, press
and hold briefly before dragging, or just open the card and change its board
there. Task detail is deep-linked at `/t/<id>`, so a card can be bookmarked
or shared.

Cards an agent (or the TUI, or a `git pull`) touched since you last looked
are badged — green for new, amber for changed — using `todomd changes --as
web`. Opening a card clears its badge; your own edits never raise one.

## 🔒 It listens on localhost only

todomd-web binds `127.0.0.1` and cannot be told otherwise. It has no
authentication and it creates, edits and deletes files on your machine —
publishing that port would be handing anyone on the network a shell-adjacent
capability.

**Use it on the machine the file lives on.** To reach it from your phone,
put something that does authentication and transport security in front:

```sh
tailscale serve --bg 7337        # https://<machine>.<tailnet>.ts.net, tailnet only
ssh -L 7337:127.0.0.1:7337 you@host   # or an SSH tunnel
```

Both give you the board on a phone without exposing anything to the wider
network.

## 🤝 How it works with agents

The file stays the interface. An agent runs `todomd add`, `todomd comment
--author ai`, `todomd done`; you refresh the browser (or just switch back to
the tab — it refetches on focus) and see it. Concurrent writes are safe
because both processes take todomd's own advisory lock and it replaces the
file atomically.

Every request re-reads through the CLI, and every write is expressed as a
task id (`todomd update 3f2a --title …`), never as a whole-file save — so a
browser tab left open overnight cannot clobber a morning's worth of agent
work.

## 🧩 The HTTP API

The JSON is todomd's own pinned schema, passed straight through.

| Method | Path | Body |
|---|---|---|
| `GET` | `/api/config` | — |
| `GET` | `/api/board` | — |
| `GET` | `/api/changes` | — (advances the `web` cursor) |
| `POST` | `/api/tasks` | `{board?, title, description?, tags?, due?}` |
| `PATCH` | `/api/tasks/{id}` | any of `{title, description, tags, due}`; `due: null` and `tags: []` clear |
| `POST` | `/api/tasks/{id}/move` | `{to?, pos?}` — `pos` is 1-based after removal, omit to append |
| `POST` | `/api/tasks/{id}/comments` | `{author, text}` |
| `DELETE` | `/api/tasks/{id}` | — |

Errors come back as `{"error": "…"}` with todomd's own message: `404` no such
task, `409` ambiguous id prefix, `400` anything it rejected.

## 🛠️ Development

```sh
mise run build          # build the UI bundle, then the binary
mise run test           # go test ./...
cd web && npm test      # vitest
```

For UI work, run the server and Vite side by side:

```sh
todomd-web &                       # or: go run . --dev http://127.0.0.1:5173
cd web && npm run dev              # proxies /api to :7337, hot-reloads the UI
```

`web/dist` is committed on purpose: the Go binary embeds it, so a clone
builds without Node. CI rebuilds it and fails if the committed copy is stale
— run `mise run build-web` and commit the result.

## 📄 License

[MIT](LICENSE)
