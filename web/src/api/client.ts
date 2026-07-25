import type {
  BoardResponse,
  ChangesResponse,
  Config,
  NewProject,
  NewTask,
  Project,
  ProjectsResponse,
  TaskPatch,
  TaskResponse,
  UpdateStatus,
  UpgradeResult,
} from './types'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!res.ok) {
    // Errors carry todomd's own message ("no task with id …", "invalid date
    // …"), which is more useful than anything we could invent here.
    let message = res.statusText
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // fall through with the status text
    }
    throw new ApiError(message, res.status)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const body = (value: unknown) => JSON.stringify(value)

/** Every board and task call names its project, so nothing here depends on
 *  the server remembering which one you are looking at. */
const scope = (project: string) => `/projects/${encodeURIComponent(project)}`

export const api = {
  config: () => request<Config>('/config'),

  update: () => request<UpdateStatus>('/update'),

  /** Installs the latest release. The server restarts into it, so the reply
   *  usually arrives just before the connection goes away. */
  upgrade: () => request<UpgradeResult>('/update', { method: 'POST' }),

  projects: () => request<ProjectsResponse>('/projects'),

  addProject: (project: NewProject) =>
    request<Project>('/projects', { method: 'POST', body: body(project) }),

  /** Renaming changes the project's id too, so the response is its new
   *  identity — follow it rather than reusing the old one. */
  renameProject: (id: string, name: string) =>
    request<Project>(`/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: body({ name }),
    }),

  /** Takes the project off the list. The todo file stays where it is. */
  removeProject: (id: string) =>
    request<void>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  board: (project: string) => request<BoardResponse>(`${scope(project)}/board`),

  changes: (project: string) => request<ChangesResponse>(`${scope(project)}/changes`),

  createTask: (project: string, task: NewTask) =>
    request<TaskResponse>(`${scope(project)}/tasks`, { method: 'POST', body: body(task) }),

  updateTask: (project: string, id: string, patch: TaskPatch) =>
    request<TaskResponse>(`${scope(project)}/tasks/${id}`, {
      method: 'PATCH',
      body: body(patch),
    }),

  /** pos is 1-based in the target board after the task is removed from where
   *  it was — exactly the index a drop target reports. 0 appends. */
  moveTask: (project: string, id: string, to: string, pos: number) =>
    request<TaskResponse>(`${scope(project)}/tasks/${id}/move`, {
      method: 'POST',
      body: body({ to, pos }),
    }),

  addComment: (project: string, id: string, author: string, text: string) =>
    request<TaskResponse>(`${scope(project)}/tasks/${id}/comments`, {
      method: 'POST',
      body: body({ author, text }),
    }),

  deleteTask: (project: string, id: string) =>
    request<void>(`${scope(project)}/tasks/${id}`, { method: 'DELETE' }),
}
