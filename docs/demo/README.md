# Re-recording the demo gif

`docs/demo.gif` and `docs/demo-light.gif` are generated, not hand-recorded.
To refresh them after a feature change:

```sh
brew install agent-browser ffmpeg   # once; todomd, go and node you already have
sh docs/demo/record.sh              # both themes
sh docs/demo/record.sh light        # or just one
```

That builds the current binary, seeds two scratch projects and the config
file that lists them, serves them on `127.0.0.1:7999`, drives a headless
browser through the demo, and renders the gifs (820px, 10fps, ~25s): `docs/demo.gif` for dark and
`docs/demo-light.gif` for light, which the README picks between with
`prefers-color-scheme`. Each theme gets a fresh board and a fresh state dir.
Nothing outside `/tmp/todomd-web-demo` and `docs/demo*.gif` is touched.

The pieces:

| File | What it does |
|---|---|
| `record.sh` | Orchestrates per theme: build → seed → serve → drive → ffmpeg |
| `seed.sh` | The two projects the demo shows, and the config listing them |
| `drive.mjs` | The interactions. Edit this to change what happens |
| `cursor.js` | Draws the mouse pointer, which the recorder does not |

## Changing what the demo shows

- **Board content**: `seed.sh` — plain `todomd` commands over two projects.
  It prints the id of the task the driver opens, so keep that `add_id` line
  intact. The list is config-backed on purpose: a command-line list renders
  the switcher as plain text, which is not what a user with several projects
  sees.
- **Interactions**: `drive.mjs` — cards are found by their title text, so
  renaming a task in `seed.sh` means renaming it there too. Keep the pauses
  generous; viewers read slower than scripts click.
- **Output size/pacing**: the `ffmpeg` line in `record.sh`.

## Hard-won gotchas — read before debugging

1. **Pinning the theme has three dead ends.** `agent-browser set media dark`
   silently kills the recording (0.1s of empty video), and so does a `reload`
   inside the recording context — while localStorage set *before*
   `record start` is not inherited by the fresh context it creates. What works
   is flipping `documentElement.classList` on the loaded page; the driver
   reports how long that setup took and `record.sh` trims exactly that much
   off the head with ffmpeg's `trim` filter.
2. **Set the viewport before `record start`.** The video's dimensions are
   fixed when the recording context is created, and it inherits the viewport
   in force at that moment — set it afterwards and you get a 1280×578 video of
   a cropped board, with `innerWidth` still reporting the size you asked for.
   `record.sh` ffprobes the webm and refuses to convert a wrong-sized one.
3. **The webm is finalised asynchronously.** Converting straight after
   `record stop` yields a two-frame gif. `record.sh` waits for the file size
   to stop changing.
4. **A leftover server on the port silently records the wrong board.** The
   driver's "an agent edits the file" step then writes to a file nobody is
   serving, and the unread badges never appear. `record.sh` refuses to start
   if the port is taken, and checks that `/api/config` reports *its* file.
5. **`agent-browser batch` takes JSON on stdin**, not JSON strings as
   arguments. The driver uses it to run a whole cursor glide in one process —
   a spawn per mouse move is too slow to look like a hand moving.
6. **The recorder draws no mouse pointer.** `cursor.js` renders one from real
   pointer events (capture phase, so a drag library that stops propagation
   cannot blind it). Without it the drag looks like cards moving by themselves.
7. **Nothing waits forever.** The webm settle loop, the port wait and the
   server-start wait are all bounded: a driver that exits without recording
   used to leave `record.sh` spinning with nothing on screen to say why.
8. **Run it in the foreground.** Driving agent-browser from a detached
   background shell produced no video at all, repeatedly, while the identical
   command in the foreground worked every time.
9. **Dates in the demo are relative** (`Wed`, `Aug 1`), so the due badges look
   different depending on when you record. Adjust the `--due` values in
   `seed.sh` if they start reading as overdue.
