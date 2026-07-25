import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from './client'
import type { BoardResponse, NewProject, NewTask, TaskPatch } from './types'

/** Query keys are scoped by project, so switching boards is a cache hit and
 *  each project refetches on its own. */
export const boardKey = (project: string) => ['board', project] as const
export const projectsKey = ['projects'] as const
export const configKey = ['config'] as const

/** The board is refetched whenever the window regains focus, which is how a
 *  change made by an agent (or in the TUI) shows up without any watching. */
export function useBoard(project: string | undefined) {
  return useQuery({
    queryKey: boardKey(project ?? ''),
    queryFn: () => api.board(project!),
    enabled: !!project,
  })
}

export function useProjects() {
  return useQuery({ queryKey: projectsKey, queryFn: api.projects })
}

export function useConfig() {
  return useQuery({ queryKey: configKey, queryFn: api.config, staleTime: Infinity })
}

function useBoardMutation<TArgs, TResult>(
  project: string,
  fn: (args: TArgs) => Promise<TResult>,
  options: { onError?: string } = {},
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onError: (err: Error) =>
      toast.error(options.onError ?? 'Something went wrong', { description: err.message }),
    onSettled: () => qc.invalidateQueries({ queryKey: boardKey(project) }),
  })
}

export function useCreateTask(project: string) {
  return useBoardMutation(project, (task: NewTask) => api.createTask(project, task), {
    onError: 'Could not add the task',
  })
}

export function useUpdateTask(project: string) {
  return useBoardMutation(
    project,
    ({ id, patch }: { id: string; patch: TaskPatch }) => api.updateTask(project, id, patch),
    { onError: 'Could not save the task' },
  )
}

export function useAddComment(project: string) {
  return useBoardMutation(
    project,
    ({ id, author, text }: { id: string; author: string; text: string }) =>
      api.addComment(project, id, author, text),
    { onError: 'Could not add the comment' },
  )
}

export function useDeleteTask(project: string) {
  return useBoardMutation(project, (id: string) => api.deleteTask(project, id), {
    onError: 'Could not delete the task',
  })
}

export interface MoveArgs {
  id: string
  to: string
  /** 1-based position in the target board after removal; 0 appends. */
  pos: number
}

/** Moving is optimistic: the card lands where it was dropped immediately and
 *  only snaps back if todomd rejects the move. */
export function useMoveTask(project: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, to, pos }: MoveArgs) => api.moveTask(project, id, to, pos),
    onMutate: async (args: MoveArgs) => {
      await qc.cancelQueries({ queryKey: boardKey(project) })
      const previous = qc.getQueryData<BoardResponse>(boardKey(project))
      if (previous) qc.setQueryData(boardKey(project), applyMove(previous, args))
      return { previous }
    },
    onError: (err: Error, _args, context) => {
      if (context?.previous) qc.setQueryData(boardKey(project), context.previous)
      toast.error('Could not move the task', { description: err.message })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: boardKey(project) }),
  })
}

export function useAddProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (project: NewProject) => api.addProject(project),
    onError: (err: Error) =>
      toast.error('Could not add the project', { description: err.message }),
    onSuccess: (project) => toast.success(`Added ${project.name}`),
    onSettled: () => qc.invalidateQueries({ queryKey: projectsKey }),
  })
}

export function useRemoveProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.removeProject(id),
    onError: (err: Error) =>
      toast.error('Could not remove the project', { description: err.message }),
    onSuccess: () => toast.success('Removed from the list', { description: 'The file is untouched.' }),
    onSettled: () => qc.invalidateQueries({ queryKey: projectsKey }),
  })
}

/** applyMove mirrors what todomd does server-side: remove the task, then
 *  insert it at pos-1 of the target board as it stands after the removal. */
export function applyMove(board: BoardResponse, { id, to, pos }: MoveArgs): BoardResponse {
  const moved = board.boards.flatMap((b) => b.tasks).find((t) => t.id === id)
  if (!moved) return board
  const target = to || moved.board
  const boards = board.boards.map((b) => ({
    ...b,
    tasks: b.tasks.filter((t) => t.id !== id),
  }))
  const column = boards.find((b) => b.name === target)
  if (!column) return board
  const index = pos > 0 && pos <= column.tasks.length ? pos - 1 : column.tasks.length
  column.tasks.splice(index, 0, { ...moved, board: target })
  return { ...board, boards }
}
