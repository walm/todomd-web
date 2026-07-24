import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { Board, Task } from '@/api/types'
import type { MoveArgs } from '@/api/hooks'
import { TaskCard } from '@/components/task-card'

/** Droppable id for a column's empty space, kept out of the task id space. */
export const columnDroppableId = (board: string) => `column:${board}`

export interface BoardDndProps {
  boards: Board[]
  onMove: (args: MoveArgs) => void
  children: React.ReactNode
}

/**
 * Drag-and-drop for the whole board.
 *
 * The index maths is the one place this has to agree with todomd: dnd-kit
 * reports the position of the card you dropped onto in the list as it stands
 * *before* the move, and `todomd move --pos` inserts at that same index once
 * the dragged task has been removed. So `pos = index + 1`, in both directions
 * and across columns — pinned down by a test on each side.
 *
 * Touch drags need a press delay, or every attempt to scroll a column would
 * start a drag instead.
 */
export function BoardDnd({ boards, onMove, children }: BoardDndProps) {
  const [dragging, setDragging] = useState<Task | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const index = useMemo(() => {
    const map = new Map<string, { task: Task; board: string; pos: number; last: boolean }>()
    for (const board of boards) {
      board.tasks.forEach((task, i) =>
        map.set(task.id, {
          task,
          board: board.name,
          pos: i,
          last: i === board.tasks.length - 1,
        }),
      )
    }
    return map
  }, [boards])

  const onDragStart = (event: DragStartEvent) =>
    setDragging(index.get(String(event.active.id))?.task ?? null)

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null)
    if (!over) return
    const from = index.get(String(active.id))
    if (!from) return

    const overId = String(over.id)
    if (overId.startsWith('column:')) {
      // Dropped on a column's empty space: append, unless it is already the
      // last card there and nothing would change.
      const to = overId.slice('column:'.length)
      if (from.board === to && from.last) return
      onMove({ id: from.task.id, to, pos: 0 })
      return
    }

    const target = index.get(overId)
    if (!target || target.task.id === from.task.id) return
    onMove({ id: from.task.id, to: target.board, pos: target.pos + 1 })
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {dragging && <TaskCard task={dragging} className="w-72 rotate-1 shadow-lg" />}
      </DragOverlay>
    </DndContext>
  )
}
