// Drives the browser for docs/demo.gif through the agent-browser CLI, which
// does the recording too. No automation library, no browser download: one
// binary the recorder already has.
//
//   node drive.mjs --url http://127.0.0.1:7999 --file /tmp/x/TODO.md \
//                  --task 3f2a --video /tmp/x/demo.webm
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const url = arg('url', 'http://127.0.0.1:7999')
const file = arg('file')
const task = arg('task')
const video = arg('video', 'demo.webm')
const theme = arg('theme', 'dark')
const trimFile = arg('trim', 'trim.txt')

const WIDTH = 1000
const HEIGHT = 620

const ab = (...args) => execFileSync('agent-browser', args, { encoding: 'utf8' }).trim()
/** Batch mode takes a JSON array of commands on stdin — one process for a
 *  whole glide instead of one per mouse move. */
const batch = (commands) =>
  execFileSync('agent-browser', ['batch', '--bail'], {
    input: JSON.stringify(commands),
    encoding: 'utf8',
  })
const todomd = (...args) => execFileSync('todomd', ['--file', file, ...args], { stdio: 'ignore' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** Runs JS in the page; agent-browser prints the result as JSON. */
const evaluate = (expression) => JSON.parse(ab('eval', expression) || 'null')

/** Point to aim at on the card whose text contains `title` (near its top, so
 *  the pointer lands on the title rather than the tag row). */
const cardPoint = (title) =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll('[data-task]')]
      .find((e) => e.textContent.includes(${JSON.stringify(title)}))
    if (!el) throw new Error('no card: ' + ${JSON.stringify(title)})
    const r = el.getBoundingClientRect()
    return [Math.round(r.x + r.width / 2), Math.round(r.y + 24)]
  })()`)

const controlPoint = (name) =>
  evaluate(`(() => {
    const wanted = ${JSON.stringify(name)}
    const el = [...document.querySelectorAll('button, [role=button]')].find(
      (e) => ((e.getAttribute('aria-label') ?? e.textContent) ?? '').trim() === wanted,
    )
    if (!el) throw new Error('no control: ' + wanted)
    const r = el.getBoundingClientRect()
    return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]
  })()`)

/** One agent-browser invocation per glide, so the pointer moves smoothly
 *  without paying process-spawn cost per step. */
let at = [WIDTH / 2, HEIGHT - 30]
function glide([x, y], { steps = 16, hold = 25 } = {}) {
  const [x0, y0] = at
  const commands = []
  for (let i = 1; i <= steps; i++) {
    const px = Math.round(x0 + ((x - x0) * i) / steps)
    const py = Math.round(y0 + ((y - y0) * i) / steps)
    commands.push(['mouse', 'move', String(px), String(py)], ['wait', String(hold)])
  }
  batch(commands)
  at = [x, y]
}

async function click(point, { pause = 400 } = {}) {
  glide(point)
  batch([['mouse', 'down'], ['wait', '90'], ['mouse', 'up']])
  await wait(pause)
}

/** Drag with enough intermediate moves for a drag library to follow. */
async function drag(from, to) {
  glide(from)
  ab('mouse', 'down')
  await wait(200)
  const steps = 24
  const commands = []
  for (let i = 1; i <= steps; i++) {
    const px = Math.round(from[0] + ((to[0] - from[0]) * i) / steps)
    const py = Math.round(from[1] + ((to[1] - from[1]) * i) / steps)
    commands.push(['mouse', 'move', String(px), String(py)], ['wait', '30'])
  }
  batch(commands)
  at = to
  await wait(300)
  ab('mouse', 'up')
  await wait(900)
}

// ── record ──────────────────────────────────────────────────────────────────

ab('open')
// The video's dimensions are fixed when the recording context is created, and
// it inherits the viewport set before it — so this has to come first, or the
// recording silently comes out at the default window size with the board
// cropped. The second call sizes the new context's own page.
ab('set', 'viewport', String(WIDTH), String(HEIGHT))
ab('record', 'start', video)
const started = Date.now()
ab('set', 'viewport', String(WIDTH), String(HEIGHT))
ab('open', url)
ab('wait', '[data-task]')

// Pinning the theme is fiddlier than it looks (see docs/demo/README.md):
// `agent-browser set media dark` leaves the recorder with an empty video, and
// so does a reload inside the recording context — while a fresh context does
// not inherit the localStorage set before it. So the class is flipped in
// place, on the loaded page, and the brief lead-in is trimmed off the video.
ab('eval', `(() => {
  localStorage.setItem('todomd-web:theme', ${JSON.stringify(theme)})
  document.documentElement.classList.toggle('dark', ${theme === 'dark'})
})()`)

const state = evaluate(`[
  innerWidth, innerHeight, document.documentElement.classList.contains('dark')
]`)
if (state[2] !== (theme === 'dark')) {
  throw new Error(`theme did not apply: wanted ${theme}, got ${state[2] ? 'dark' : 'light'}`)
}
if (state[0] !== WIDTH || state[1] !== HEIGHT) {
  throw new Error(`viewport is ${state[0]}x${state[1]}, wanted ${WIDTH}x${HEIGHT}`)
}

ab('eval', readFileSync(join(here, 'cursor.js'), 'utf8'))
ab('mouse', 'move', String(at[0]), String(at[1]))
await wait(1200)

// Everything before this point is setup; record.sh cuts it from the video.
writeFileSync(trimFile, String(Math.max(0, (Date.now() - started) / 1000 - 0.5)))

// 1. Open the task an agent has been working on — markdown, highlighted code
//    and the agent's comment.
await click(cardPoint('Rewrite the parser'), { pause: 1000 })
await wait(2000)

// 2. Reply to it. The comment box already holds focus.
ab('keyboard', 'type', 'Nice — merging this after the release.')
await wait(700)
await click(controlPoint('Comment'), { pause: 1600 })
await wait(1200)
ab('press', 'Escape')
await wait(1100)

// 3. Drag a card across the board.
await drag(cardPoint('Ship the web UI'), cardPoint('Rewrite the parser'))
await wait(900)

// 4. Meanwhile an agent works the same file through the CLI…
todomd('add', 'Add a --read-only mode', '--board', 'Backlog', '--tag', 'cli')
todomd('comment', task, '--author', 'ai', 'Pushed the fix — the round-trip test covers it now.')

// …and its work turns up on the board, badged unread.
await click(controlPoint('Reload from disk'), { pause: 2000 })
await wait(2400)

glide([WIDTH / 2, HEIGHT - 24], { steps: 10 })
await wait(1200)

ab('record', 'stop')
// The video is finalised when the recording context closes; closing the
// browser on top of that too early truncates the file.
await wait(1500)
ab('close')
console.log(`recorded ${video} (${theme})`)
