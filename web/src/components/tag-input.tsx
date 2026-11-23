import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Input } from '@/components/ui/input'
import { parseTags } from '@/lib/tags'
import {
  applyTag,
  suggest,
  wordAt,
  type TagCount,
  type TagMode,
} from '@/lib/tag-suggest'
import { cn } from '@/lib/utils'

type InputProps = Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'>

export interface TagInputProps extends InputProps {
  value: string
  onValueChange: (value: string) => void
  /** The project's tags with counts, from the loaded board. */
  tags: TagCount[]
  /** `tags` for a tags field; `filter` for the board filter, where
   *  suggestions follow `#` or `tag:`. */
  mode?: TagMode
  wrapperClassName?: string
}

/** A text input that suggests the project's existing tags for the word being
 *  typed. An ARIA combobox: focus stays in the input and the active row is
 *  named by aria-activedescendant. */
export function TagInput({
  value,
  onValueChange,
  tags,
  mode = 'tags',
  wrapperClassName,
  ref: outerRef,
  onKeyDown,
  onBlur,
  onFocus,
  ...props
}: TagInputProps) {
  const id = useId()
  const ref = useRef<HTMLInputElement | null>(null)
  const [caret, setCaret] = useState(0)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const w = useMemo(() => wordAt(value, caret, mode), [value, caret, mode])
  const rows = useMemo(() => {
    if (!w) return []
    if (mode === 'tags' && !w.word) return []
    const exclude =
      mode === 'tags' ? parseTags(value.slice(0, w.start) + ' ' + value.slice(w.end)) : []
    return suggest(tags, w.word, { exclude, create: mode === 'tags' })
  }, [w, tags, value, mode])

  const shown = open && rows.length > 0
  // The list is portalled out and placed against the input: a dialog's scroll
  // area would otherwise clip it, and on a phone so would the sheet.
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null)
  useEffect(() => {
    if (!shown) return
    const place = () => {
      const r = ref.current?.getBoundingClientRect()
      if (r) setBox({ left: r.left, top: r.bottom + 4, width: r.width })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [shown, value])
  const at = Math.min(active, rows.length - 1)
  const optionId = (i: number) => `${id}-opt-${i}`

  const sync = (el: HTMLInputElement) => {
    setCaret(el.selectionStart ?? el.value.length)
  }

  const pick = (i: number) => {
    const row = rows[i]
    if (!row || !w) return
    const next = applyTag(value, w, row.tag)
    onValueChange(next.value)
    setOpen(false)
    setActive(0)
    setCaret(next.caret)
    requestAnimationFrame(() => ref.current?.setSelectionRange(next.caret, next.caret))
  }

  return (
    <div className={cn('relative', wrapperClassName)}>
      <Input
        {...props}
        ref={(el) => {
          ref.current = el
          if (typeof outerRef === 'function') outerRef(el)
          else if (outerRef) outerRef.current = el
        }}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={shown ? `${id}-list` : undefined}
        aria-activedescendant={shown ? optionId(at) : undefined}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        onChange={(e) => {
          onValueChange(e.target.value)
          sync(e.target)
          setOpen(true)
          setActive(0)
        }}
        onClick={(e) => sync(e.currentTarget)}
        onKeyUp={(e) => {
          if (!['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) sync(e.currentTarget)
        }}
        onFocus={(e) => {
          sync(e.currentTarget)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setOpen(false)
          onBlur?.(e)
        }}
        onKeyDown={(e) => {
          if (shown && !e.nativeEvent.isComposing) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const n = rows.length
              setActive((at + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              pick(at)
              return
            }
            if (e.key === 'Escape') {
              // Close the list, not the dialog around it.
              e.preventDefault()
              e.stopPropagation()
              setOpen(false)
              return
            }
          }
          onKeyDown?.(e)
        }}
      />
      {shown && box && createPortal(
        <ul
          id={`${id}-list`}
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
              aria-selected={i === at}
              // Keep focus in the input: the press must not blur it.
              onMouseDown={(e) => e.preventDefault()}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
              onMouseMove={() => setActive(i)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 select-none',
                i === at && 'bg-accent text-accent-foreground',
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
      )}
    </div>
  )
}
