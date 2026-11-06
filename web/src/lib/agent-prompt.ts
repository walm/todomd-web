// "Connect an agent": where to start a coding agent and a ready-made prompt
// that has it watch this project's TODO.md with the todomd CLI. Nothing is
// stored; each person copies the prompt and changes the rules to suit them.

/** The parts of a project the prompt needs, as /api/projects lists them. */
export interface AgentProject {
  name: string
  /** An absolute path, or `host:path` for a project over ssh. */
  file: string
  /** The ssh destination, for a project on another machine. */
  host?: string
}

export interface AgentPromptInput {
  project: AgentProject
  /** The board names, in order. */
  boards: string[]
  /** The name the agent comments as and keeps its change cursor under. */
  agent?: string
}

/** Where the file is, from the point of view of the agent: on this machine,
 *  or on the ssh host it has to run on. */
export interface FileLocation {
  host?: string
  path: string
  dir: string
}

export function fileLocation({ file, host }: AgentProject): FileLocation {
  let path = file
  if (host) {
    path = file.startsWith(`${host}:`) ? file.slice(host.length + 1) : file.replace(/^[^:/]+:/, '')
  }
  const cut = path.lastIndexOf('/')
  const dir = cut > 0 ? path.slice(0, cut) : cut === 0 ? '/' : '.'
  return { host, path, dir }
}

export interface FlowBoards {
  /** Where new cards arrive. */
  inbox: string
  /** Where a card goes while the agent works on it. */
  working: string
  /** Where finished cards go. */
  done: string
}

/** Picks the boards the default rules talk about: by name where it can, by
 *  position otherwise, and todomd's defaults when there are none. */
export function flowBoards(boards: string[]): FlowBoards {
  const find = (re: RegExp) => boards.find((b) => re.test(b))
  const inbox = find(/backlog|inbox|todo|to do/i) ?? boards[0] ?? 'Backlog'
  const done =
    find(/^done$|complete|finished|shipped/i) ??
    (boards.length > 1 ? boards[boards.length - 1] : 'Done')
  const working =
    find(/progress|doing|active|working/i) ??
    boards.find((b) => b !== inbox && b !== done) ??
    'In Progress'
  return { inbox, working, done }
}

/** Quotes a word for a POSIX shell only when it needs it. A leading ~ stays
 *  outside the quotes so the shell still expands it. */
export function shellQuote(s: string): string {
  if (s !== '' && /^[\w@%+=:,./~-]+$/.test(s)) return s
  if (s.startsWith('~/')) return `~/${shellQuote(s.slice(2))}`
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** A board name in double quotes, safe in prose and on a command line. */
const board = (s: string) => `"${s.replace(/(["\\$`])/g, '\\$1')}"`

/** The commands that put a terminal next to the file, to start the agent in. */
export function startCommands(project: AgentProject): string[] {
  const { host, dir } = fileLocation(project)
  const cd = `cd ${shellQuote(dir)}`
  return host ? [`ssh ${shellQuote(host)}`, cd] : [cd]
}

export function agentPrompt({ project, boards, agent = 'agent' }: AgentPromptInput): string {
  const { host, path } = fileLocation(project)
  const { inbox, working, done } = flowBoards(boards)
  const f = `-f ${shellQuote(path)}`
  const as = `--as ${shellQuote(agent)}`
  const where = host
    ? `${path} on this machine (${host}). I watch the same file from
todomd-web on my own computer, over ssh.`
    : `${path}, which I have open in todomd-web.`

  return `You are working on the todomd board "${project.name}". Its cards live in
${where}
Use the \`todomd\` CLI for every board change, always with
\`${f}\`; don't edit the file by hand.

## How to watch the board

Loop until I tell you to stop:

1. Wait for changes:
   todomd changes --wait ${as} --ignore-author ${shellQuote(agent)} --json ${f}
   (It returns when cards are added, moved, updated or commented on, and
   skips your own writes. On "timed_out": true, just run it again.)
2. For each event, read the card with \`todomd show <id> ${f}\`
   and act on it by the rules below.
3. Go back to step 1.

Write as yourself so I can tell your comments apart:
- Comment:  todomd comment <id> "<text>" --author ${shellQuote(agent)} ${as} ${f}
- Move:     todomd move <id> --to "<board>" ${as} ${f}

## Rules (change these to fit how you work)

- New card in ${board(inbox)}: read it and answer in one short comment. Answer
  questions directly ("Is this possible?" → "Yes, but we should plan first.
  Should I do that?"). If it's unclear, ask one short question. If it's
  bigger work, say so and offer a short plan. Don't start the work.
- A comment from me on a card you answered: reply the same way, briefly.
- I comment "GO" on a card, or move it to ${board(working)}: pick it up. Move
  it to ${board(working)} if it isn't there, do the work, and comment short
  progress notes as you go.
- When the work is done: comment what changed and how to check it, then
  move the card to ${board(done)}.
- If you get stuck or need a decision, comment the question on the card
  and wait for my answer instead of guessing.
- Never delete cards, and never start on a card until I say GO or move it
  to ${board(working)}.
`
}

/** The first todomd with `changes --wait`, which the prompt's loop needs. */
export const MIN_TODOMD = 'v0.10.0'

/** True only for a version that parses and is older than MIN_TODOMD: a dev
 *  build or an unknown version gets the benefit of the doubt. */
export function todomdTooOld(version: string | undefined): boolean {
  const parse = (v: string) => /^v?(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1).map(Number)
  const have = version ? parse(version) : undefined
  const need = parse(MIN_TODOMD)!
  if (!have) return false
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return have[i] < need[i]
  }
  return false
}
