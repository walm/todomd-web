// Mirrors todomd's pinned JSON schema, which the Go server passes through
// unchanged — the same shape agents see from `todomd list --json`.

export interface Comment {
  author: string
  date: string
  text: string
}

/** todomd always sends one, so nothing here infers the default. */
export type Priority = 'high' | 'normal' | 'low'

export interface Task {
  id: string
  board: string
  title: string
  tags: string[]
  priority: Priority
  due: string | null
  description: string
  comments: Comment[]
}

export interface Board {
  name: string
  tasks: Task[]
}

export interface BoardResponse {
  project: string
  file: string
  rev: string
  boards: Board[]
}

export interface Config {
  /** How often an open board re-reads, in ms; 0 when polling is off. */
  pollMs: number
  author: string
  version: string
  todomdVersion: string
  /** False when the project list came from the command line, in which case
   *  the UI hides its add and remove controls. */
  configurable: boolean
  configFile: string
}

export interface UpdateStatus {
  current: string
  latest?: string
  available: boolean
  releaseUrl?: string
  /** False for a development build, or when checking is switched off. */
  supported: boolean
  checkedAt?: string
}

export interface UpgradeResult {
  upgraded: boolean
  version: string
  /** The server is replacing itself; wait for it and reload. */
  restarting: boolean
}

export interface Project {
  id: string
  name: string
  file: string
  dir: string
  /** Set when the project lives on another machine, reached over ssh. */
  host?: string
  /** How often this project re-reads itself, in ms; 0 when off. A remote
   *  project defaults to a longer interval than a local one. */
  pollMs: number
  /** False when the file has been moved or deleted since it was listed.
   *  Remote projects are taken on trust; they report their errors when
   *  opened. */
  available: boolean
}

export interface ProjectsResponse {
  projects: Project[]
  configurable: boolean
}

export interface NewProject {
  file: string
  name?: string
  /** Create the file with `todomd init` when it does not exist yet. */
  create?: boolean
  /** The todomd binary for this project — a remote host's non-interactive
   *  PATH often lacks it. */
  todomd?: string
}

export type ChangeType =
  | 'task_added'
  | 'task_deleted'
  | 'task_moved'
  | 'task_updated'
  | 'comment_added'

export interface ChangeEvent {
  type: ChangeType
  task: string
  title: string
  board: string
  from?: string
  to?: string
  fields?: Record<string, { old: unknown; new: unknown }>
  comment?: Comment
  detail?: Task
}

export interface ChangesResponse {
  project: string
  rev: string
  initialized: boolean
  events: ChangeEvent[]
}

export interface TaskResponse {
  project: string
  task: Task
  rev: string
}

export interface NewTask {
  board?: string
  title: string
  description?: string
  tags?: string[]
  priority?: Priority
  due?: string | null
}

/** Fields left out are unchanged; `due: null` and `tags: []` clear them. */
export interface TaskPatch {
  title?: string
  description?: string
  tags?: string[]
  /** "normal" is the cleared state; there is nothing else to clear. */
  priority?: Priority
  due?: string | null
}
