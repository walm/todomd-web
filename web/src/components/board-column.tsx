import { Plus } from 'lucide-react'
import type { Board, Task } from '@/api/types'
import { Button } from '@/components/ui/button'
import { TaskCard } from '@/components/task-card'
import type { UnreadKind } from '@/hooks/use-unread'

export interface BoardColumnProps {
  board: Board
  unreadOf: (id: string) => UnreadKind | undefined
  onOpen: (task: Task) => void
  onAdd: (board: string) => void
  /** Total before filtering, so a filtered column still shows what it hides. */
  total: number
}

export function BoardColumn({ board, unreadOf, onOpen, onAdd, total }: BoardColumnProps) {
  const hidden = total - board.tasks.length
  return (
    <section className="flex w-[85vw] max-w-100 shrink-0 snap-start flex-col sm:w-80 md:snap-align-none">
      <header className="flex items-center gap-2 px-1 pb-1.5">
        <h2 className="text-sm font-semibold tracking-tight">{board.name}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{total}</span>
        <div className="grow" />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Add a task to ${board.name}`}
          onClick={() => onAdd(board.name)}
        >
          <Plus />
        </Button>
      </header>

      <div className="flex min-h-24 grow flex-col gap-2 overflow-y-auto rounded-xl bg-muted/50 p-2">
        {board.tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            unread={unreadOf(task.id)}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(task)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpen(task)
              }
            }}
          />
        ))}
        {board.tasks.length === 0 && (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            {hidden > 0 ? `${hidden} hidden by the filter` : 'Nothing here'}
          </p>
        )}
        {board.tasks.length > 0 && hidden > 0 && (
          <p className="px-1 pt-1 text-center text-xs text-muted-foreground">
            {hidden} hidden by the filter
          </p>
        )}
      </div>
    </section>
  )
}
