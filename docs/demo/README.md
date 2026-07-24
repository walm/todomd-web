# Re-recording the demo gif

`docs/demo.gif` is generated, not hand-recorded. To refresh it after a
feature change:

```sh
brew install agent-browser ffmpeg   # once; todomd, go and node you already have
sh docs/demo/record.sh
```

That builds the current binary, seeds a scratch `TODO.md`, serves it on
`127.0.0.1:7999`, drives a headless browser through the demo, and renders the
gif (860px, 10fps, ~20s). Nothing outside `/tmp/todomd-web-demo` and
`docs/demo.gif` is touched.

The pieces:

| File | What it does |
|---|---|
| `record.sh` | Orchestrates: build → seed → serve → drive → ffmpeg |
| `seed.sh` | The board the demo shows. Edit this to change the content |
| `drive.mjs` | The interactions. Edit this to change what happens |
| `cursor.js` | Draws the mouse pointer, which the recorder does not |

## Changing what the demo shows

- **Board content**: `seed.sh` — plain `todomd` commands. It prints the id of
  the task the driver opens, so keep the last `add_id` line intact.
- **Interactions**: `drive.mjs` — cards are found by their title text, so
  renaming a task in `seed.sh` means renaming it there too. Keep the pauses
  generous; viewers read slower than scripts click.
- **Output size/pacing**: the `ffmpeg` line in `record.sh`.

## Hard-won gotchas — read before debugging

1. **`agent-browser set media dark` silently kills the recording.** The video
   comes out 0.1s long and empty. Dark mode is set through the app's own
   `todomd-web:theme` localStorage key instead, before `record start` — which
   opens a fresh context but preserves localStorage, so the board is dark from
   its first painted frame.
2. **The webm is finalised asynchronously.** Converting straight after
   `record stop` yields a two-frame gif. `record.sh` waits for the file size
   to stop changing.
3. **A leftover server on the port silently records the wrong board.** The
   driver's "an agent edits the file" step then writes to a file nobody is
   serving, and the unread badges never appear. `record.sh` refuses to start
   if the port is taken, and checks that `/api/config` reports *its* file.
4. **`agent-browser batch` takes JSON on stdin**, not JSON strings as
   arguments. The driver uses it to run a whole cursor glide in one process —
   a spawn per mouse move is too slow to look like a hand moving.
5. **The recorder draws no mouse pointer.** `cursor.js` renders one from real
   pointer events (capture phase, so a drag library that stops propagation
   cannot blind it). Without it the drag looks like cards moving by themselves.
6. **Dates in the demo are relative** (`Wed`, `Aug 1`), so the due badges look
   different depending on when you record. Adjust the `--due` values in
   `seed.sh` if they start reading as overdue.
