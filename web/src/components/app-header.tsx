import { useEffect, useRef } from 'react'
import { Plus, RefreshCw, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/utils'

export interface AppHeaderProps {
  /** The project switcher, rendered where the file name used to be. */
  project: React.ReactNode
  file?: string
  query: string
  onQueryChange: (value: string) => void
  /** False when there is no project to add tasks to yet. */
  canEdit: boolean
  onAdd: () => void
  onRefresh: () => void
  refreshing: boolean
  unreadCount: number
  onClearUnread: () => void
}

export function AppHeader({
  project,
  file,
  query,
  onQueryChange,
  canEdit,
  onAdd,
  onRefresh,
  refreshing,
  unreadCount,
  onClearUnread,
}: AppHeaderProps) {
  const search = useRef<HTMLInputElement>(null)

  // "/" focuses search, "n" adds a task — unless you are already typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return
      if (target?.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '/') {
        e.preventDefault()
        search.current?.focus()
      } else if (e.key === 'n') {
        e.preventDefault()
        onAdd()
      } else if (e.key === 'r') {
        e.preventDefault()
        onRefresh()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onAdd, onRefresh])

  const dir = file?.split('/').slice(0, -1).join('/')

  return (
    <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        {/* A short project name takes only what it needs; a long one is capped
            so the filter keeps a usable width on a phone. */}
        <div className="min-w-0 shrink">
          {project}
          {dir && (
            <p className="ml-1.5 hidden truncate text-xs text-muted-foreground sm:block" title={file}>
              {dir}
            </p>
          )}
        </div>

        {/* The filter takes whatever the header has left, which on a phone is
            most of it; from sm up it settles at a fixed width. */}
        <div className="relative min-w-0 grow basis-0 sm:ml-auto sm:w-64 sm:grow-0 sm:basis-auto">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={search}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Filter"
            aria-label="Filter tasks"
            className="h-8 pl-7 text-base md:text-sm"
          />
          {query && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Clear filter"
              className="absolute top-1/2 right-1 -translate-y-1/2"
              onClick={() => onQueryChange('')}
            >
              <X />
            </Button>
          )}
        </div>

        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
            onClick={onClearUnread}
            title="Mark everything as read"
          >
            {unreadCount} unread
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Reload from disk"
          onClick={onRefresh}
        >
          <RefreshCw className={cn(refreshing && 'animate-spin')} />
        </Button>
        <ThemeToggle />
        <Button size="sm" onClick={onAdd} disabled={!canEdit}>
          <Plus />
          <span className="hidden sm:inline">Add task</span>
        </Button>
      </div>
    </header>
  )
}
