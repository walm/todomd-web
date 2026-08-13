import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { useDeleteBoard } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import { ResponsiveDialog } from '@/components/responsive-dialog'
import { cn } from '@/lib/utils'

export interface BoardDeleteProps {
  project: string
  board: string
  /** How many tasks the board holds, before any filter. */
  tasks: number
  className?: string
}

/**
 * Deleting a board from its own heading. An empty one goes on the click —
 * there is nothing to lose and a confirmation for nothing trains people to
 * dismiss the ones that matter. A board with tasks asks first and says how
 * many, because todomd deletes those tasks with it and the file is the only
 * record.
 */
export function BoardDelete({ project, board, tasks, className }: BoardDeleteProps) {
  const [confirming, setConfirming] = useState(false)
  const remove = useDeleteBoard(project)

  const del = (force: boolean) =>
    remove.mutate({ board, force }, { onSuccess: () => setConfirming(false) })

  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Delete board ${board}`}
        title={tasks > 0 ? `Delete ${board} and its ${tasks} tasks` : `Delete empty board ${board}`}
        disabled={remove.isPending}
        className={cn(
          'opacity-0 transition-opacity group-hover/board:opacity-100 focus-visible:opacity-100',
          className,
        )}
        onClick={() => (tasks > 0 ? setConfirming(true) : del(false))}
      >
        <Trash2 />
      </Button>

      <ResponsiveDialog
        open={confirming}
        onOpenChange={(next) => !next && setConfirming(false)}
        title={`Delete ${board}?`}
      >
        <div className="flex flex-col gap-4 pb-1">
          <p className="text-sm">
            It holds{' '}
            <span className="font-medium">
              {tasks} task{tasks === 1 ? '' : 's'}
            </span>
            , which will be deleted with it. If the file is in git you can get
            them back from its history; otherwise this is the only copy.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() => del(true)}
            >
              {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Delete board and tasks
            </Button>
          </div>
        </div>
      </ResponsiveDialog>
    </>
  )
}
