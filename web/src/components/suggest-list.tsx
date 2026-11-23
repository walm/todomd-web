import { useEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Suggestion } from '@/lib/tag-suggest'
import { cn } from '@/lib/utils'

export interface SuggestListProps {
  id: string
  rows: Suggestion[]
  active: number
  /** The element the list hangs under. */
  anchor: RefObject<HTMLElement | null>
  optionId: (i: number) => string
  onPick: (i: number) => void
  onHover: (i: number) => void
}

/** The suggestion listbox. It is portalled out and placed against the anchor:
 *  a dialog's scroll area would otherwise clip it, and on a phone so would the
 *  sheet. Presses do not take focus from the input. */
export function SuggestList({ id, rows, active, anchor, optionId, onPick, onHover }: SuggestListProps) {
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null)
  useEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect()
      if (r) setBox({ left: r.left, top: r.bottom + 4, width: r.width })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    // The field can grow as pills are added.
    const ro =
      anchor.current && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : undefined
    if (anchor.current) ro?.observe(anchor.current)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      ro?.disconnect()
    }
  }, [anchor, rows])
  if (!box) return null
  return createPortal(
    <ul
      id={id}
      role="listbox"
      aria-label="Tag suggestions"
      style={{ left: box.left, top: box.top, minWidth: Math.max(box.width, 160) }}
      className="fixed z-[100] max-h-56 overflow-auto rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md"
    >
      {rows.map((row, i) => (
        <li
          key={row.create ? `create:${row.tag}` : row.tag}
          id={optionId(i)}
          role="option"
          aria-selected={i === active}
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onPick(i)}
          onMouseMove={() => onHover(i)}
          className={cn(
            'flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 select-none',
            i === active && 'bg-accent text-accent-foreground',
          )}
        >
          {row.create ? (
            <span>
              Create “<span className="font-medium">{row.tag}</span>”
            </span>
          ) : (
            <span className="truncate">
              {row.tag} <span className="text-muted-foreground">· {row.count}</span>
            </span>
          )}
        </li>
      ))}
    </ul>,
    document.body,
  )
}
