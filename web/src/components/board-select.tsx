import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

const NEW_BOARD = '__new_board__'

export interface BoardSelectProps {
  value: string
  boards: string[]
  onChange: (board: string) => void
  disabled?: boolean
  className?: string
}

/**
 * A native <select> on purpose: it becomes the platform picker on a phone,
 * which beats any custom listbox for one-handed use. New boards can be typed
 * in — todomd creates a missing board on the fly (before "Done").
 */
export function BoardSelect({
  value,
  boards,
  onChange,
  disabled,
  className,
}: BoardSelectProps) {
  const options = boards.includes(value) ? boards : [value, ...boards]
  return (
    <div className={cn('relative', className)}>
      <select
        value={value}
        disabled={disabled}
        aria-label="Board"
        onChange={(e) => {
          if (e.target.value === NEW_BOARD) {
            const name = window.prompt('New board name')?.trim()
            if (name) onChange(name)
            return
          }
          onChange(e.target.value)
        }}
        className={cn(
          // 16px on phones: anything smaller and iOS zooms the page when the
          // picker opens, which leaves the board scrolled somewhere else.
          'h-9 appearance-none rounded-md border bg-background py-0 pr-6 pl-2 text-base font-medium',
          'md:h-7 md:text-xs',
          'transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
          'disabled:opacity-50',
        )}
      >
        {options.map((board) => (
          <option key={board} value={board}>
            {board}
          </option>
        ))}
        <option value={NEW_BOARD}>New board…</option>
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-1.5 size-3 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}
