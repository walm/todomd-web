import { Plus } from 'lucide-react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Board, Task } from '@/api/types'
import { Button } from '@/components/ui/button'
import { TaskCard } from '@/components/task-card'
import { columnDroppableId } from '@/lib/dnd'
import type { UnreadKind } from '@/hooks/use-unread'
import { cn } from '@/lib/utils'

export interface BoardColumnProps {
  board: Board
  unreadOf: (id: string) => UnreadKind | undefined
  onOpen: (task: Task) => void
  onAdd: (board: string) => void
  /** Task count before filtering, so a filtered column still shows what it hides. */
  total: number
}

export function BoardColumn({ board, unreadOf, onOpen, onAdd, total }: BoardColumnProps) {
  const hidden = total - board.tasks.length
  const { setNodeRef, isOver } = useDroppable({ id: columnDroppableId(board.name) })

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
            <SortableCard
              key={task.id}
              task={task}
              unread={unreadOf(task.id)}
              onOpen={onOpen}
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

interface SortableCardProps {
  task: Task
  unread: UnreadKind | undefined
  onOpen: (task: Task) => void
}

function SortableCard({ task, unread, onOpen }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id })

  return (
    <TaskCard
      ref={setNodeRef}
      task={task}
      unread={unread}
      dragging={isDragging}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // A drag starts after a few pixels of movement (or a press on touch),
      // so a plain tap still opens the task.
      onClick={() => onOpen(task)}
      {...attributes}
      {...listeners}
      // …and for keyboards, Enter opens the task while Space (dnd-kit's other
      // activator) starts a drag.
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onOpen(task)
          return
        }
        listeners?.onKeyDown?.(event)
      }}
    />
  )
}
