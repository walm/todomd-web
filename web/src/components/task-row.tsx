import { CalendarDays, MessageSquare } from 'lucide-react'
import type { TaskCardProps } from '@/components/task-card'
import { PriorityMark } from '@/components/priority-mark'
import { Badge } from '@/components/ui/badge'
import { dueUrgency, formatDue } from '@/lib/due'
import { cn } from '@/lib/utils'

const urgencyClass = {
  overdue: 'text-destructive',
  soon: 'text-amber-600 dark:text-amber-400',
  later: 'text-muted-foreground',
}

/** A task as one line, for the list view: the same information a card shows,
 *  laid out to be read down a phone screen rather than across a board. */
export function TaskRow({ task, unread, dragging, className, ...props }: TaskCardProps) {
  return (
    <div
      data-task={task.id}
      className={cn(
        'group flex cursor-pointer items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left shadow-xs transition-colors',
        'hover:border-foreground/20 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        unread === 'new' && 'border-emerald-500/60',
        unread === 'changed' && 'border-amber-500/60',
        dragging && 'opacity-40',
        className,
      )}
      {...props}
    >
      {unread ? (
        <span
          aria-label={unread === 'new' ? 'New' : 'Changed'}
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            unread === 'new' ? 'bg-emerald-500' : 'bg-amber-500',
          )}
        />
      ) : (
        <span className="size-1.5 shrink-0" />
      )}

      <p className="min-w-0 grow truncate text-sm font-medium">{task.title}</p>

      <div className="flex shrink-0 items-center gap-1.5">
        <PriorityMark priority={task.priority} />
        {task.tags.slice(0, 2).map((tag) => (
          <Badge key={tag} variant="secondary" className="hidden font-normal sm:inline-flex">
            {tag}
          </Badge>
        ))}
        {task.comments.length > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <MessageSquare className="size-3" />
            {task.comments.length}
          </span>
        )}
        {task.due && (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-xs whitespace-nowrap',
              urgencyClass[dueUrgency(task.due)],
            )}
            title={task.due}
          >
            <CalendarDays className="size-3" />
            {formatDue(task.due)}
          </span>
        )}
      </div>
    </div>
  )
}
