import { useId, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { SuggestList } from '@/components/suggest-list'
import { parseTags } from '@/lib/tags'
import { suggest, type TagCount } from '@/lib/tag-suggest'
import { cn } from '@/lib/utils'

export interface TagFieldProps {
  /** The tags so far, one pill each. */
  tags: string[]
  onTagsChange: (tags: string[]) => void
  /** The text not yet turned into a pill. The form owns it so that a submit
   *  (⌘↵) can still take what has been typed. */
  text: string
  onTextChange: (text: string) => void
  /** The project's tags with counts, for suggestions. */
  suggestions: TagCount[]
  placeholder?: string
  className?: string
}

/** Merges new tags in, dropping blanks and ones already there. */
export function addTags(have: string[], input: string[]): string[] {
  const out = [...have]
  for (const tag of input.flatMap((t) => parseTags(t))) if (!out.includes(tag)) out.push(tag)
  return out
}

/** The tags field of the card forms: each tag a pill with a remove button,
 *  then the input. Comma, space or Enter turns the text into a pill; Backspace
 *  in the empty input selects, then removes, the last one; ←/→ walk the pills.
 *  Suggestions work as in the filter box and hang under the field. */
export function TagField({
  tags,
  onTagsChange,
  text,
  onTextChange,
  suggestions,
  placeholder = 'tags',
  className,
}: TagFieldProps) {
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [sel, setSel] = useState<number | null>(null)

  const rows = useMemo(() => {
    const word = text.replace(/^#/, '').trim()
    if (!word) return []
    return suggest(suggestions, word, { exclude: tags, create: true })
  }, [suggestions, tags, text])
  const shown = open && rows.length > 0
  const at = Math.min(active, rows.length - 1)
  const optionId = (i: number) => `${id}-opt-${i}`

  const add = (more: string[]) => {
    onTagsChange(addTags(tags, more))
    onTextChange('')
    setActive(0)
    setSel(null)
  }
  const remove = (i: number) => {
    onTagsChange(tags.filter((_, j) => j !== i))
    setSel(null)
    input.current?.focus()
  }
  const pick = (i: number) => {
    const row = rows[i]
    if (!row) return
    add([row.tag])
    setOpen(false)
    input.current?.focus()
  }

  return (
    <div
      ref={box}
      role="group"
      aria-label="Tags"
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'UL') {
          input.current?.focus()
        }
      }}
      className={cn(
        'flex min-h-8 min-w-32 cursor-text flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-1 text-base transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 md:text-sm dark:bg-input/30',
        className,
      )}
    >
      {tags.length > 0 && (
        <ul role="list" aria-label="Current tags" className="contents">
          {tags.map((tag, i) => (
            <li key={tag} className="group/pill contents">
              <Badge
                variant="secondary"
                className={cn(
                  'animate-in fade-in zoom-in-95 gap-0.5 bg-foreground/12 pr-0.5 font-normal duration-150',
                  sel === i && 'ring-2 ring-ring',
                )}
              >
                {tag}
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  onClick={() => remove(i)}
                  className="inline-flex size-4 items-center justify-center rounded-full opacity-0 transition-opacity group-hover/pill:opacity-100 hover:bg-foreground/15 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring [@media(hover:none)]:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={input}
        value={text}
        role="combobox"
        aria-label="Add tag"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={shown ? `${id}-list` : undefined}
        aria-activedescendant={shown ? optionId(at) : undefined}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder={tags.length ? undefined : placeholder}
        className="h-6 min-w-16 flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground"
        onChange={(e) => {
          const v = e.target.value
          setSel(null)
          setOpen(true)
          setActive(0)
          // A comma or space ends the tag (and a paste of several ends them all).
          if (/[\s,]/.test(v)) add([v])
          else onTextChange(v)
        }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text')
          if (!/[\s,]/.test(pasted.trim())) return
          e.preventDefault()
          add([text + pasted])
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          const empty = text === ''
          if (shown) {
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
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !empty) {
            e.preventDefault()
            add([text])
          } else if (e.key === 'Backspace' && empty && tags.length > 0) {
            e.preventDefault()
            if (sel === tags.length - 1) remove(sel)
            else setSel(tags.length - 1)
          } else if (e.key === 'ArrowLeft' && empty && tags.length > 0) {
            e.preventDefault()
            setSel(Math.max(0, (sel ?? tags.length) - 1))
          } else if (e.key === 'ArrowRight' && sel !== null) {
            e.preventDefault()
            setSel(sel + 1 >= tags.length ? null : sel + 1)
          } else if (e.key === 'Delete' && sel !== null) {
            e.preventDefault()
            remove(sel)
          } else if (e.key.length === 1) setSel(null)
        }}
      />
      {shown && (
        <SuggestList
          id={`${id}-list`}
          rows={rows}
          active={at}
          anchor={box}
          optionId={optionId}
          onPick={pick}
          onHover={setActive}
        />
      )}
    </div>
  )
}
