import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useBoard, useConfig, useMoveTask } from '@/api/hooks'
import type { Task } from '@/api/types'
import { AppHeader } from '@/components/app-header'
import { BoardColumn } from '@/components/board-column'
import { BoardDnd } from '@/components/board-dnd'
import { TaskCreate } from '@/components/task-create'
import { TaskDetail } from '@/components/task-detail'
import { filterBoards } from '@/lib/filter'
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
  const move = useMoveTask()
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

        {/* Drop positions come from the unfiltered board: dropping a card
            "onto" another means taking its place in the file, which has to
            hold regardless of what the filter hides. */}
        {board.isSuccess && (
          <BoardDnd boards={boards} onMove={(args) => move.mutate(args)}>
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
          </BoardDnd>
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
