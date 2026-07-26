# Projects over SSH — plan

Serve a `TODO.md` that lives on another machine, so the board can show the
work an agent is doing on a server — and you can reply to it — without
installing todomd-web there or copying files around.

```sh
todomd-web deploy@web1:/srv/app/TODO.md ~/src/todomd-web/TODO.md
```

One board, some projects local, some remote.

---

## 0. Is this the right thing to build?

Worth stating plainly before the design: **for a single remote host, this
feature is not the best answer.** Installing todomd-web there and reaching it
over `tailscale serve` or an SSH tunnel is zero new code and lower latency,
and the README already recommends exactly that.

This earns its place when you have *several* machines — a couple of servers,
a laptop, a VM — and want one board that switches between them, which is what
the project switcher made possible. If that is not the shape of the problem,
the honest recommendation is to skip it.

The rest of this assumes we want it.

---

## 1. Why it is a small change

Every read and write already goes through one subprocess call:

```go
// internal/todomd/client.go
cmd := exec.CommandContext(ctx, c.Bin, full...)   // todomd --file X list --json
```

Remote is the same call with a prefix:

```go
cmd := exec.CommandContext(ctx, "ssh", "web1", "todomd --file 'X' list --json")
```

Everything above that line — the API, the board, drag-and-drop, unread badges
— is untouched, because it all speaks to `Client`, not to a filesystem.

**Locking comes out right for free.** todomd's advisory flock runs on the
machine holding the file, so a board edit serializes with the agent's own
`todomd` runs *there*. That is the property that rules out the obvious
alternative of mounting the file over sshfs and pretending it is local: flock
over FUSE is unreliable, and a lock taken on your laptop protects nothing on
the server.

Same for change cursors: `todomd changes --as web` keeps its state in the
remote state dir, so each machine tracks what the board has seen of it.

---

## 2. Decisions to confirm

### 2.1 How a remote project is written — recommend scp syntax

```jsonc
{ "projects": [
  { "file": "deploy@web1:/srv/app/TODO.md" },
  { "file": "web1:/srv/other/TODO.md", "name": "Other" },   // ssh config alias
  { "file": "/Users/walm/src/todomd-web/TODO.md" }
]}
```

It is what people already type, it works unchanged on the command line, and
SSH config aliases, jump hosts and per-host users keep working because we
shell out to `ssh` and inherit `~/.ssh/config` untouched.

A path is remote when it matches `^[A-Za-z0-9_.@-]+:` **and** what follows the
colon starts with `/` or `~`. A local file with a colon in its name is
possible but vanishingly rare; `./weird:name.md` still works because of the
leading dot.

Project names default to the directory today; for remote they should default
to `host:dir` (e.g. `web1:app`) so two servers with an `/srv/app` are
distinguishable at a glance. Renaming already exists for the rest.

### 2.2 SSH options — recommend sensible defaults, no new config surface

Every invocation gets:

| Option | Why |
|---|---|
| `ControlMaster=auto`, `ControlPersist=60s`, `ControlPath=<state>/ssh/%C` | A fresh handshake is 100–300 ms and the unread poll hits every project; multiplexing takes that to ~10 ms after the first |
| `BatchMode=yes` | A host that wants a passphrase must fail fast with a message, not hang a request on a prompt nobody can see |
| `ConnectTimeout=10` | An unreachable host should not hold a board request for a minute |

The user's `~/.ssh/config` still applies (we do not pass `-F`), so anything
exotic — jump hosts, keys, ports — is configured where it already is. No
credentials, keys or passwords enter todomd-web's config.

### 2.3 Quoting — the one place this can go genuinely wrong

`ssh host cmd args…` concatenates into a single string for the *remote*
shell, so today's guarantee — "no shell is involved, so titles and comments
containing quotes, newlines or `$` need no escaping" — disappears exactly
where the untrusted-ish text is. Every argument gets single-quoted with the
`'\''` dance.

Recommend making this a pure function, `remoteCommand(bin string, args
[]string) string`, so it is table-tested without a network, and pointing the
existing torture case at it: the integration tests already round-trip a
comment containing `$HOME`, backticks, a newline and `## not a board`.

### 2.4 Where todomd lives on the remote host — recommend a per-project override

`ssh web1 todomd …` frequently fails with `command not found` even when it
works interactively, because a non-interactive shell skips `.profile` — and
todomd's own installer puts it in `~/.local/bin`. So:

- config gets an optional `"todomd": "/home/deploy/.local/bin/todomd"` per
  project (the existing global `--todomd` flag stays the default), and
- exit code 127 is translated to say precisely this, with the fix in the
  message. Anyone who hits it should not have to guess.

### 2.5 Availability — recommend optimistic, with errors on open

`/api/projects` currently `os.Stat`s each file to decide `available`. Doing
that remotely would be an SSH round trip per project on every list. Recommend
remote projects report `available: true` without checking, and the board
surfaces the real error when opened (the switcher can show the failing
project greyed once we know). Adding a project *does* verify — one
`todomd list --json` over SSH — because failing at that moment is much
cheaper than a mystery empty board later.

---

## 3. Changes

```
internal/todomd/remote.go   NEW: address parsing, quoting, ssh argv
internal/todomd/client.go   Client gains Host/SSH options; run() prefixes when remote
internal/project/registry.go  accept remote addresses (no os.Stat), name from host:dir
internal/server/projects.go   describe(): availability for remote; add verifies over SSH
web/src/components/…          a "remote" chip in the switcher, host in the subtitle
```

`Client` grows two fields and one branch in `run()`:

```go
type Client struct {
    Bin  string   // todomd on the target machine
    File string   // absolute path there
    Host string   // "" for local; "deploy@web1" otherwise
}
```

### Errors worth translating

| What happens | What the user sees |
|---|---|
| ssh exit 255 | `cannot reach web1 over ssh: <stderr>` |
| exit 127 | `todomd is not on PATH on web1 — set "todomd" for this project to its full path` |
| todomd's own exits (1/2/3) | unchanged: they already map to 400/404/409 |
| host key changed | ssh's own message, passed through — we must not touch `known_hosts` |

---

## 4. What this costs

- **Latency**: a warm multiplexed connection adds ~10–30 ms per request. A
  board load is one round trip; a drag is one, and it is already optimistic in
  the UI, so it will feel the same. A cold connection (first request after 60
  s idle) is 100–300 ms, which is noticeable but not painful.
- **A dependency on `ssh` being on PATH** — universal on macOS and Linux,
  which is all we ship.
- **A remote todomd of a compatible version.** The JSON schema is pinned, so
  this is mild, but the README should say "todomd on both ends".

---

## 5. Tests

- **Pure**: address parsing (user@host, alias, `~` paths, local paths with
  colons), and the quoting function against the torture strings — no network.
- **Hermetic end-to-end**: a fake `ssh` on `PATH` that records its argv and
  replays canned JSON, mirroring the fake `todomd` the client tests already
  use. This proves the whole argv chain — including quoting — without a host.
- **Real host, opt-in**: the existing integration suite pointed at
  `TODOMD_WEB_SSH_HOST` (skipped when unset), so anyone with a box can run the
  same lifecycle tests over SSH. CI stays hermetic.

## 6. Milestones

- [ ] **M1 — Remote client.** Address parsing, quoting, ssh argv and options,
      error translation, tests. Verifiable with `todomd-web web1:/path/TODO.md`.
- [ ] **M2 — Registry and config.** Remote addresses on the command line and
      in the config file, `host:dir` naming, per-project `todomd` path,
      verification on add.
- [ ] **M3 — Server and UI.** Availability handling, remote chip in the
      switcher, ssh failures surfaced as themselves rather than as a broken
      board.
- [ ] **M4 — Ship.** README (including the two gotchas that will bite:
      non-interactive PATH, and first-connection latency), CHANGELOG, v0.4.0.

I cannot test any of this from here without a host to talk to — localhost SSH
fails host-key verification on this machine, and I am not going to touch
`known_hosts` or enable Remote Login to get around that. Point me at a box you
don't mind me writing a scratch `TODO.md` on, or run the M1 check yourself
when it lands.

## 7. Out of scope

- Any credential handling: no keys, passwords, or agent management in
  todomd-web. If `ssh host true` doesn't work in your terminal, this won't
  either — and that's the right boundary.
- sshfs/rsync-style syncing, or a local cache of remote files. Both break the
  single-lock guarantee that makes this safe next to a working agent.
- A daemon on the remote host. If you're willing to run one, run todomd-web
  itself and tunnel to it (see §0).
