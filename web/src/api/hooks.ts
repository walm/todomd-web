import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from './client'
import type { BoardResponse, NewTask, TaskPatch } from './types'

export const boardKey = ['board'] as const
export const configKey = ['config'] as const

/** The board is refetched whenever the window regains focus, which is how a
 *  change made by an agent (or in the TUI) shows up without any watching. */
export function useBoard() {
  return useQuery({ queryKey: boardKey, queryFn: api.board })
}

export function useConfig() {
  return useQuery({ queryKey: configKey, queryFn: api.config, staleTime: Infinity })
}

function useBoardMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  options: { onError?: string } = {},
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onError: (err: Error) => toast.error(options.onError ?? 'Something went wrong', {
      description: err.message,
    }),
    onSettled: () => qc.invalidateQueries({ queryKey: boardKey }),
  })
}

export function useCreateTask() {
  return useBoardMutation((task: NewTask) => api.createTask(task), {
    onError: 'Could not add the task',
  })
}

export function useUpdateTask() {
  return useBoardMutation(
    ({ id, patch }: { id: string; patch: TaskPatch }) => api.updateTask(id, patch),
    { onError: 'Could not save the task' },
  )
}

export function useAddComment() {
  return useBoardMutation(
    ({ id, author, text }: { id: string; author: string; text: string }) =>
      api.addComment(id, author, text),
    { onError: 'Could not add the comment' },
  )
}

export function useDeleteTask() {
  return useBoardMutation((id: string) => api.deleteTask(id), {
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
export function useMoveTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, to, pos }: MoveArgs) => api.moveTask(id, to, pos),
    onMutate: async (args: MoveArgs) => {
      await qc.cancelQueries({ queryKey: boardKey })
      const previous = qc.getQueryData<BoardResponse>(boardKey)
      if (previous) qc.setQueryData(boardKey, applyMove(previous, args))
      return { previous }
    },
    onError: (err: Error, _args, context) => {
      if (context?.previous) qc.setQueryData(boardKey, context.previous)
      toast.error('Could not move the task', { description: err.message })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: boardKey }),
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
