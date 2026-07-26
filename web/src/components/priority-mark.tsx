import { ChevronDown, ChevronUp } from 'lucide-react'
import type { Priority } from '@/api/types'
import { cn } from '@/lib/utils'

/** Normal is the default and says nothing, so it shows nothing — same as the
 *  TUI, which marks only ▲ high and ▼ low. */
export function PriorityMark({
  priority,
  className,
}: {
  priority: Priority
  className?: string
}) {
  if (priority === 'normal') return null
  const high = priority === 'high'
  return (
    <span
      title={`Priority: ${priority}`}
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium',
        high ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
    >
      {high ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
      {priority}
    </span>
  )
}
