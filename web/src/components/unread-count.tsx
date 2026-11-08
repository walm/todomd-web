import { describeUnread, toneOf, type UnreadSummary } from '@/hooks/use-unread'
import { cn } from '@/lib/utils'

/** A count of cards to look at, coloured like the card badges: green when any
 *  of them is new, amber when they are only changed. Nothing when zero. */
export function UnreadCount({
  summary,
  label,
  className,
}: {
  summary: UnreadSummary
  /** Prefixed to the tooltip, e.g. "In other projects:". */
  label?: string
  className?: string
}) {
  const tone = toneOf(summary)
  if (!tone) return null
  const description = [label, describeUnread(summary)].filter(Boolean).join(' ')
  return (
    <span
      data-tone={tone}
      title={description}
      aria-label={description}
      className={cn(
        'inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[0.65rem] font-medium tabular-nums',
        tone === 'new'
          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
          : 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
        className,
      )}
    >
      {summary.count}
    </span>
  )
}
