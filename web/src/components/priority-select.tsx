import { ChevronDown } from 'lucide-react'
import type { Priority } from '@/api/types'
import { cn } from '@/lib/utils'

const OPTIONS: Priority[] = ['high', 'normal', 'low']

/** A native select, for the same reason the board picker is one: on a phone it
 *  becomes the platform picker, and it stays 16px so iOS does not zoom. */
export function PrioritySelect({
  value,
  onChange,
  disabled,
  className,
}: {
  value: Priority
  onChange: (value: Priority) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <select
        value={value}
        disabled={disabled}
        aria-label="Priority"
        onChange={(e) => onChange(e.target.value as Priority)}
        className={cn(
          'h-9 w-full appearance-none rounded-lg border border-input bg-transparent py-0 pr-7 pl-2.5 text-base',
          'transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          'disabled:opacity-50 md:h-8 md:text-sm dark:bg-input/30',
        )}
      >
        {OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option === 'normal' ? 'normal priority' : `${option} priority`}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}
