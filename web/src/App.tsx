import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useBoard, useConfig } from '@/api/hooks'
import type { Board, Task } from '@/api/types'
import { AppHeader } from '@/components/app-header'
import { BoardColumn } from '@/components/board-column'
import { TaskCreate } from '@/components/task-create'
import { TaskDetail } from '@/components/task-detail'
import { useUnread } from '@/hooks/use-unread'
import { Button } from '@/components/ui/button'

/** Task detail is deep-linked at /t/<id> so a card can be bookmarked or
 *  shared; one route does not need a router. */
function idFromLocation(): string | null {
  const m = /^\/t\/([0-9a-z]+)$/.exec(window.location.pathname)
  return m ? m[1] : null
}

export default function App() {
  const board = useBoard()
  const config = useConfig()
  const qc = useQueryClient()
  const { unreadOf, markRead, markAllRead, count } = useUnread()

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(idFromLocation)
  const [creatingIn, setCreatingIn] = useState<string | null>(null)

  useEffect(() => {
    const onPop = () => setSelected(idFromLocation())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const openTask = useCallback(
    (task: Task) => {
      setSelected(task.id)
      markRead(task.id)
      window.history.pushState(null, '', `/t/${task.id}`)
    },
    [markRead],
  )

  const closeTask = useCallback(() => {
    setSelected(null)
    if (idFromLocation()) window.history.pushState(null, '', '/')
  }, [])

  const boards = useMemo(() => board.data?.boards ?? [], [board.data])
  const boardNames = boards.map((b) => b.name)
  const filtered = useMemo(() => filterBoards(boards, query), [boards, query])
  const task = boards.flatMap((b) => b.tasks).find((t) => t.id === selected) ?? null

  // A deep link to a task that no longer exists shouldn't leave a dead modal.
  useEffect(() => {
    if (selected && board.isSuccess && !task) closeTask()
  }, [selected, task, board.isSuccess, closeTask])

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <AppHeader
        file={board.data?.file ?? config.data?.file}
        query={query}
        onQueryChange={setQuery}
        onAdd={() => setCreatingIn(boardNames[0] ?? 'Backlog')}
        onRefresh={() => void qc.invalidateQueries()}
        refreshing={board.isFetching}
        unreadCount={count}
        onClearUnread={markAllRead}
      />

      <main className="min-h-0 grow">
        {board.isPending && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Reading the file…
          </div>
        )}

        {board.isError && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <AlertTriangle className="size-6 text-destructive" />
            <p className="max-w-prose text-sm">{board.error.message}</p>
            <Button size="sm" variant="outline" onClick={() => void board.refetch()}>
              Try again
            </Button>
          </div>
        )}

        {board.isSuccess && (
          <div className="flex h-full snap-x snap-mandatory gap-3 overflow-x-auto px-3 pt-3 pb-4 md:snap-none">
            {filtered.map((column, i) => (
              <BoardColumn
                key={column.name}
                board={column}
                total={boards[i].tasks.length}
                unreadOf={unreadOf}
                onOpen={openTask}
                onAdd={setCreatingIn}
              />
            ))}
          </div>
        )}
      </main>

      {task && (
        <TaskDetail
          task={task}
          boards={boardNames}
          defaultAuthor={config.data?.author ?? 'user'}
          open
          onOpenChange={(next) => !next && closeTask()}
        />
      )}

      <TaskCreate
        open={creatingIn !== null}
        onOpenChange={(next) => !next && setCreatingIn(null)}
        boards={boardNames}
        board={creatingIn ?? boardNames[0] ?? 'Backlog'}
      />
    </div>
  )
}

/** Filters on everything visible on a card, plus the id and description —
 *  what you would otherwise grep the file for. */
export function filterBoards(boards: Board[], query: string): Board[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return boards
  const terms = needle.split(/\s+/)
  return boards.map((board) => ({
    ...board,
    tasks: board.tasks.filter((task) => {
      const haystack = [task.title, task.description, task.id, ...task.tags]
        .join(' ')
        .toLowerCase()
      return terms.every((term) => haystack.includes(term))
    }),
  }))
}
