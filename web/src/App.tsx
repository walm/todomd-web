import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useBoard, useConfig, useMoveTask, useProjects } from '@/api/hooks'
import type { Task } from '@/api/types'
import { AppHeader } from '@/components/app-header'
import { BoardColumn } from '@/components/board-column'
import { BoardList } from '@/components/board-list'
import { BoardDnd } from '@/components/board-dnd'
import { ProjectSwitcher } from '@/components/project-switcher'
import { TaskCreate } from '@/components/task-create'
import { TaskDetail } from '@/components/task-detail'
import { UpdateBanner } from '@/components/update-banner'
import { filterBoards } from '@/lib/filter'
import { readLocation, writeLocation } from '@/lib/location'
import { useUnread } from '@/hooks/use-unread'
import { useView } from '@/hooks/use-view'
import { Button } from '@/components/ui/button'

const LAST_PROJECT = 'todomd-web:project'

export default function App() {
  const projects = useProjects()
  const config = useConfig()
  const qc = useQueryClient()

  const [route, setRoute] = useState(readLocation)
  const [query, setQuery] = useState('')
  const [creatingIn, setCreatingIn] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  const { view, toggle: toggleView } = useView()

  useEffect(() => {
    const onPop = () => setRoute(readLocation())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const list = useMemo(() => projects.data?.projects ?? [], [projects.data])
  // The project in the URL wins; otherwise the one you looked at last, and
  // failing that the first on the list.
  const currentId = useMemo(() => {
    const remembered = localStorage.getItem(LAST_PROJECT)
    const known = (id: string | null) => list.some((p) => p.id === id)
    if (known(route.project)) return route.project!
    if (known(remembered)) return remembered!
    return list[0]?.id
  }, [list, route.project])
  const current = list.find((p) => p.id === currentId)

  const board = useBoard(currentId)
  const move = useMoveTask(currentId ?? '')
  const { unreadOf, markRead, markAllRead, renameProject, countFor, count } = useUnread({
    current: currentId,
    projects: list,
    includeOthers: list.length > 1,
  })

  // Keep the URL and the remembered project in step with what is on screen.
  useEffect(() => {
    if (!currentId) return
    localStorage.setItem(LAST_PROJECT, currentId)
    if (route.project !== currentId) {
      writeLocation({ project: currentId, task: null }, { replace: true })
      setRoute({ project: currentId, task: null })
    }
  }, [currentId, route.project])

  const selectProject = useCallback((id: string) => {
    writeLocation({ project: id, task: null })
    setRoute({ project: id, task: null })
    setQuery('')
  }, [])

  // A rename gives the project a new id, so everything pointing at the old one
  // has to follow: the marks kept in this browser, and the URL if it is open.
  const handleRenamed = useCallback(
    (from: string, to: string) => {
      renameProject(from, to)
      if (currentId === from) {
        localStorage.setItem(LAST_PROJECT, to)
        writeLocation({ project: to, task: null }, { replace: true })
        setRoute({ project: to, task: null })
      }
    },
    [currentId, renameProject],
  )

  const openTask = useCallback(
    (task: Task) => {
      if (!currentId) return
      markRead(currentId, task.id)
      writeLocation({ project: currentId, task: task.id })
      setRoute({ project: currentId, task: task.id })
    },
    [currentId, markRead],
  )

  const closeTask = useCallback(() => {
    if (!currentId) return
    writeLocation({ project: currentId, task: null })
    setRoute({ project: currentId, task: null })
  }, [currentId])

  const boards = useMemo(() => board.data?.boards ?? [], [board.data])
  const boardNames = boards.map((b) => b.name)
  const filtered = useMemo(() => filterBoards(boards, query), [boards, query])
  // Pre-filter counts, so a filtered view can still say what it is hiding.
  const totals = useMemo(
    () => Object.fromEntries(boards.map((b) => [b.name, b.tasks.length])),
    [boards],
  )
  const task = boards.flatMap((b) => b.tasks).find((t) => t.id === route.task) ?? null

  // A deep link to a task that no longer exists shouldn't leave a dead modal.
  useEffect(() => {
    if (route.task && board.isSuccess && !task) closeTask()
  }, [route.task, task, board.isSuccess, closeTask])

  // "p" opens the switcher, 1–9 jump straight to a project.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return
      if (target?.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'p' && list.length > 1) {
        e.preventDefault()
        setSwitching(true)
      } else if (/^[1-9]$/.test(e.key)) {
        const picked = list[Number(e.key) - 1]
        if (picked?.available) {
          e.preventDefault()
          selectProject(picked.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [list, selectProject])

  const configurable = projects.data?.configurable ?? false
  const noProjects = projects.isSuccess && list.length === 0

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <UpdateBanner />
      <AppHeader
        project={
          <ProjectSwitcher
            projects={list}
            current={current}
            unreadFor={countFor}
            onSelect={selectProject}
            onRenamed={handleRenamed}
            configurable={configurable}
            open={switching}
            onOpenChange={setSwitching}
          />
        }
        file={current?.file}
        query={query}
        onQueryChange={setQuery}
        canEdit={!!currentId}
        view={view}
        onToggleView={toggleView}
        onAdd={() => setCreatingIn(boardNames[0] ?? 'Backlog')}
        onRefresh={() => void qc.invalidateQueries()}
        refreshing={board.isFetching || projects.isFetching}
        unreadCount={count}
        onClearUnread={() => currentId && markAllRead(currentId)}
      />

      <main className="min-h-0 grow">
        {noProjects && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-muted-foreground">
              No todo files yet.
            </p>
            <Button size="sm" onClick={() => setSwitching(true)}>
              Add a project
            </Button>
          </div>
        )}

        {!noProjects && (board.isPending || projects.isPending) && (
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
            {view === 'list' ? (
              <BoardList
                boards={filtered}
                totals={totals}
                unreadOf={unreadOf}
                onOpen={openTask}
                onAdd={setCreatingIn}
              />
            ) : (
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
          </BoardDnd>
        )}
      </main>

      {task && currentId && (
        <TaskDetail
          project={currentId}
          task={task}
          boards={boardNames}
          defaultAuthor={config.data?.author ?? 'user'}
          open
          onOpenChange={(next) => !next && closeTask()}
        />
      )}

      {currentId && (
        <TaskCreate
          project={currentId}
          open={creatingIn !== null}
          onOpenChange={(next) => !next && setCreatingIn(null)}
          boards={boardNames}
          board={creatingIn ?? boardNames[0] ?? 'Backlog'}
        />
      )}
    </div>
  )
}
