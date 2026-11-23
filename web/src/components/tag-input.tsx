import { useId, useMemo, useRef, useState } from 'react'
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
import { SuggestList } from '@/components/suggest-list'

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
      {shown && (
        <SuggestList
          id={`${id}-list`}
          rows={rows}
          active={at}
          anchor={ref}
          optionId={optionId}
          onPick={pick}
          onHover={setActive}
        />
      )}
    </div>
  )
}
