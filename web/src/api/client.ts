import type {
  BoardResponse,
  ChangesResponse,
  Config,
  NewTask,
  TaskPatch,
  TaskResponse,
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

export const api = {
  config: () => request<Config>('/config'),
  board: () => request<BoardResponse>('/board'),
  changes: () => request<ChangesResponse>('/changes'),

  createTask: (task: NewTask) =>
    request<TaskResponse>('/tasks', { method: 'POST', body: body(task) }),

  updateTask: (id: string, patch: TaskPatch) =>
    request<TaskResponse>(`/tasks/${id}`, { method: 'PATCH', body: body(patch) }),

  /** pos is 1-based in the target board after the task is removed from where
   *  it was — exactly the index a drop target reports. 0 appends. */
  moveTask: (id: string, to: string, pos: number) =>
    request<TaskResponse>(`/tasks/${id}/move`, {
      method: 'POST',
      body: body({ to, pos }),
    }),

  addComment: (id: string, author: string, text: string) =>
    request<TaskResponse>(`/tasks/${id}/comments`, {
      method: 'POST',
      body: body({ author, text }),
    }),

  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
}
