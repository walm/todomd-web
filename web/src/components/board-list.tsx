import { Plus } from 'lucide-react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Board, Task } from '@/api/types'
import { Button } from '@/components/ui/button'
import { SortableTask } from '@/components/sortable-task'
import { TaskRow } from '@/components/task-row'
import { columnDroppableId } from '@/lib/dnd'
import type { UnreadKind } from '@/hooks/use-unread'
import { cn } from '@/lib/utils'

export interface BoardListProps {
  boards: Board[]
  /** Counts before filtering, keyed by board name. */
  totals: Record<string, number>
  unreadOf: (id: string) => UnreadKind | undefined
  onOpen: (task: Task) => void
  onAdd: (board: string) => void
}

/**
 * The same board read top to bottom: every task in one column, grouped under
 * its board. A kanban board is wide by nature, which on a phone means scrolling
 * sideways to find out what is in progress; this trades that for scrolling
 * down, and keeps drag-and-drop — a row dragged under another heading moves
 * boards exactly as a card does.
 */
export function BoardList({ boards, totals, unreadOf, onOpen, onAdd }: BoardListProps) {
  return (
    <div className="mx-auto h-full w-full max-w-3xl overflow-y-auto px-3 pb-6">
      {boards.map((board) => (
        <ListGroup
          key={board.name}
          board={board}
          total={totals[board.name] ?? board.tasks.length}
          unreadOf={unreadOf}
          onOpen={onOpen}
          onAdd={onAdd}
        />
      ))}
    </div>
  )
}

interface ListGroupProps {
  board: Board
  total: number
  unreadOf: (id: string) => UnreadKind | undefined
  onOpen: (task: Task) => void
  onAdd: (board: string) => void
}

function ListGroup({ board, total, unreadOf, onOpen, onAdd }: ListGroupProps) {
  const hidden = total - board.tasks.length
  const { setNodeRef, isOver } = useDroppable({ id: columnDroppableId(board.name) })

  return (
    <section>
      {/* Sticky, so you always know which board you are looking at halfway
          down a long list. */}
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-background/90 py-2 backdrop-blur-sm">
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
          'mb-3 flex min-h-12 flex-col gap-1.5 rounded-xl transition-colors',
          isOver && 'bg-muted/70 ring-1 ring-ring/30',
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
              as={TaskRow}
            />
          ))}
        </SortableContext>

        {board.tasks.length === 0 && (
          <p className="px-1 py-3 text-xs text-muted-foreground">
            {hidden > 0 ? `${hidden} hidden by the filter` : 'Nothing here'}
          </p>
        )}
        {board.tasks.length > 0 && hidden > 0 && (
          <p className="px-1 pt-1 text-xs text-muted-foreground">
            {hidden} hidden by the filter
          </p>
        )}
      </div>
    </section>
  )
}
