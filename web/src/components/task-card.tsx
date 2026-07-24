import { MessageSquare, CalendarDays } from 'lucide-react'
import type { Task } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { dueUrgency, formatDue } from '@/lib/due'
import { cn } from '@/lib/utils'

export interface TaskCardProps extends React.ComponentProps<'div'> {
  task: Task
  /** Changed by someone else (an agent, the TUI) since this browser looked. */
  unread?: 'new' | 'changed'
  dragging?: boolean
}

const urgencyClass = {
  overdue: 'text-destructive',
  soon: 'text-amber-600 dark:text-amber-400',
  later: 'text-muted-foreground',
}

export function TaskCard({ task, unread, dragging, className, ...props }: TaskCardProps) {
  return (
    <div
      data-task={task.id}
      className={cn(
        'group cursor-pointer rounded-lg border bg-card p-2.5 text-left shadow-xs transition-colors',
        'hover:border-foreground/20 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        unread === 'new' && 'border-emerald-500/60',
        unread === 'changed' && 'border-amber-500/60',
        dragging && 'opacity-40',
        className,
      )}
      {...props}
    >
      <div className="flex items-start gap-2">
        {unread && (
          <span
            aria-label={unread === 'new' ? 'New' : 'Changed'}
            className={cn(
              'mt-1.5 size-1.5 shrink-0 rounded-full',
              unread === 'new' ? 'bg-emerald-500' : 'bg-amber-500',
            )}
          />
        )}
        <p className="grow text-sm leading-snug font-medium wrap-anywhere">{task.title}</p>
      </div>

      {(task.tags.length > 0 || task.due || task.comments.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {task.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="font-normal">
              {tag}
            </Badge>
          ))}
          {task.due && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs',
                urgencyClass[dueUrgency(task.due)],
              )}
              title={task.due}
            >
              <CalendarDays className="size-3" />
              {formatDue(task.due)}
            </span>
          )}
          {task.comments.length > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <MessageSquare className="size-3" />
              {task.comments.length}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
