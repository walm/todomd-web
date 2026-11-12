import type { ComponentType } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Task } from '@/api/types'
import type { TaskCardProps } from '@/components/task-card'
import { useLongPress } from '@/hooks/use-long-press'
import { useStickers } from '@/hooks/use-stickers'
import type { UnreadKind } from '@/hooks/use-unread'

export interface SortableTaskProps {
  task: Task
  unread: UnreadKind | undefined
  onOpen: (task: Task) => void
  /** How to draw it: a card on the board, a row in the list. */
  as: ComponentType<TaskCardProps>
}

/** The drag behaviour both views share, so a task moves the same way whether
 *  it is a card in a column or a row under a heading. */
export function SortableTask({ task, unread, onOpen, as: Component }: SortableTaskProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id })
  // On a phone, a long press opens the card's sticker sheet.
  const stickers = useStickers()
  const longPress = useLongPress(
    stickers?.supported ? () => stickers.pick(task, null) : undefined,
  )

  return (
    <Component
      ref={setNodeRef}
      task={task}
      unread={unread}
      dragging={isDragging}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // A drag starts after a few pixels of movement (or a press on touch),
      // so a plain tap still opens the task.
      onClick={() => !longPress.swallowClick() && onOpen(task)}
      {...attributes}
      {...listeners}
      onTouchStart={(event) => {
        longPress.handlers.onTouchStart(event)
        listeners?.onTouchStart?.(event)
      }}
      onTouchMove={longPress.handlers.onTouchMove}
      onTouchEnd={longPress.handlers.onTouchEnd}
      onTouchCancel={longPress.handlers.onTouchCancel}
      // No text selection or callout menu from the press itself.
      className="pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]"
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
