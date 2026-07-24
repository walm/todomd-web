// Mirrors todomd's pinned JSON schema, which the Go server passes through
// unchanged — the same shape agents see from `todomd list --json`.

export interface Comment {
  author: string
  date: string
  text: string
}

export interface Task {
  id: string
  board: string
  title: string
  tags: string[]
  due: string | null
  description: string
  comments: Comment[]
}

export interface Board {
  name: string
  tasks: Task[]
}

export interface BoardResponse {
  file: string
  rev: string
  boards: Board[]
}

export interface Config {
  file: string
  author: string
  version: string
  todomdVersion: string
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
  rev: string
  initialized: boolean
  events: ChangeEvent[]
}

export interface TaskResponse {
  task: Task
  rev: string
}

export interface NewTask {
  board?: string
  title: string
  description?: string
  tags?: string[]
  due?: string | null
}

/** Fields left out are unchanged; `due: null` and `tags: []` clear them. */
export interface TaskPatch {
  title?: string
  description?: string
  tags?: string[]
  due?: string | null
}
