// "Connect an agent": how to set a coding agent up next to this project's
// TODO.md (todomd's skill teaches it the CLI) and a short prompt that has it
// run `todomd watch` in a loop. Nothing is stored; each person copies the
// prompt and changes the rules to suit them.

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

/** `-f <path>` where todomd wouldn't find the file by itself: started in the
 *  file's folder, it finds a `TODO.md` there, but no other name. */
export function fileFlag(project: AgentProject): string {
  const { path } = fileLocation(project)
  return path.endsWith('/TODO.md') || path === 'TODO.md' ? '' : ` -f ${shellQuote(path)}`
}

/** Writes .claude/skills/todomd/SKILL.md: the CLI, the watch loop and the
 *  default rules, for the agent to read. */
export const SKILL_INSTALL = 'todomd skill --install'

/** What it takes to have the board on todomd.online as well: a login on the
 *  machine the agent runs on, and a link, unless the file has one already. */
export function onlineCommands(project: AgentProject, linked: boolean): string[] {
  return linked ? ['todomd login'] : ['todomd login', `todomd link${fileFlag(project)}`]
}

export function agentPrompt({ project, boards, agent = 'agent' }: AgentPromptInput): string {
  const { host, path } = fileLocation(project)
  const { inbox, working, done } = flowBoards(boards)
  const f = fileFlag(project)
  const name = shellQuote(agent)
  const where = host ? `${path} on this machine (${host})` : path
  const everyCommand = f ? `\nPass \`${f.trim()}\` to every todomd command.` : ''

  return `Use the todomd skill to work from my board "${project.name}"
(${where}).${everyCommand}
Run this in a loop and act on the events it prints by the rules below,
until I tell you to stop:

  todomd watch --as ${name} --ignore-author ${name} --json${f}

(If your shell cuts off long commands, add \`--timeout 100s\`.)

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

/** The first todomd with `watch` and `skill`, which the setup and the
 *  prompt need. */
export const MIN_TODOMD = 'v0.13.0'

/** How a version compares with MIN_TODOMD: negative when older, 0 or more
 *  when new enough, undefined when it doesn't parse (a dev build). */
function compareToMin(version: string | undefined): number | undefined {
  const parse = (v: string) => /^v?(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1).map(Number)
  const have = version ? parse(version) : undefined
  const need = parse(MIN_TODOMD)!
  if (!have) return undefined
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return have[i] - need[i]
  }
  return 0
}

/** True only for a version that parses and is older than MIN_TODOMD: a dev
 *  build or an unknown version gets the benefit of the doubt. */
export function todomdTooOld(version: string | undefined): boolean {
  const cmp = compareToMin(version)
  return cmp !== undefined && cmp < 0
}

/** True only for a version that parses and is MIN_TODOMD or newer. */
export function todomdNewEnough(version: string | undefined): boolean {
  const cmp = compareToMin(version)
  return cmp !== undefined && cmp >= 0
}
