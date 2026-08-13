import { Plus } from 'lucide-react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Board, Task } from '@/api/types'
import { BoardDelete } from '@/components/board-delete'
import { Button } from '@/components/ui/button'
import { SortableTask } from '@/components/sortable-task'
import { TaskCard } from '@/components/task-card'
import { columnDroppableId } from '@/lib/dnd'
import type { UnreadKind } from '@/hooks/use-unread'
import { cn } from '@/lib/utils'

export interface BoardColumnProps {
  project: string
  board: Board
  unreadOf: (id: string) => UnreadKind | undefined
  onOpen: (task: Task) => void
  onAdd: (board: string) => void
  /** Task count before filtering, so a filtered column still shows what it hides. */
  total: number
}

export function BoardColumn({ project, board, unreadOf, onOpen, onAdd, total }: BoardColumnProps) {
  const hidden = total - board.tasks.length
  const { setNodeRef, isOver } = useDroppable({ id: columnDroppableId(board.name) })

  return (
    <section className="group/board flex w-[85vw] max-w-100 shrink-0 snap-start flex-col sm:w-80 md:snap-align-none">
      <header className="flex items-center gap-2 px-1 pb-1.5">
        <h2 className="text-sm font-semibold tracking-tight">{board.name}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{total}</span>
        <div className="grow" />
        <BoardDelete project={project} board={board.name} tasks={total} />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Add a task to ${board.name}`}
          onClick={() => onAdd(board.name)}
        >
          <Plus />
        </Button>
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-24 grow flex-col gap-2 overflow-y-auto rounded-xl border p-2 transition-colors',
          'bg-muted/70 dark:bg-muted/30',
          isOver && 'bg-muted ring-1 ring-ring/30',
        )}
      >
        <SortableContext
          items={board.tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {board.tasks.map((task) => (
            <SortableTask
              key={task.id}
              task={task}
              unread={unreadOf(task.id)}
              onOpen={onOpen}
              as={TaskCard}
            />
          ))}
        </SortableContext>

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
