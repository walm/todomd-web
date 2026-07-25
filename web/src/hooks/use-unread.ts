import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { ChangeEvent, Project } from '@/api/types'

export type UnreadKind = 'new' | 'changed'

/** Unread marks, per project: { [projectId]: { [taskId]: kind } }. */
export type UnreadState = Record<string, Record<string, UnreadKind>>

const KEY = 'todomd-web:unread'

function load(): UnreadState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as UnreadState | Record<string, UnreadKind>
    return migrate(parsed)
  } catch {
    return {}
  }
}

/** Before projects existed the store was a flat { taskId: kind } map. Anything
 *  whose values are strings is one of those; keep the marks by filing them
 *  under the project the browser is looking at. */
export function migrate(parsed: UnreadState | Record<string, UnreadKind>): UnreadState {
  const values = Object.values(parsed)
  if (values.length === 0) return {}
  if (values.every((v) => typeof v === 'object' && v !== null)) return parsed as UnreadState
  return { [legacyProject()]: parsed as Record<string, UnreadKind> }
}

/** The project a pre-projects store belonged to: whatever is open now. */
function legacyProject(): string {
  const m = /^\/p\/([^/]+)/.exec(window.location.pathname)
  return m ? decodeURIComponent(m[1]) : 'default'
}

/** Moves one project's marks to a new id, merging if the target has some. */
export function moveMarks(state: UnreadState, from: string, to: string): UnreadState {
  if (from === to || !state[from]) return state
  const next = { ...state }
  next[to] = { ...(next[to] ?? {}), ...next[from] }
  delete next[from]
  return next
}

function kindOf(event: ChangeEvent): UnreadKind | null {
  switch (event.type) {
    case 'task_added':
      return 'new'
    case 'task_updated':
    case 'task_moved':
    case 'comment_added':
      return 'changed'
    default:
      return null // deletions have no card left to badge
  }
}

export interface UnreadOptions {
  /** The project on screen; its feed is read on every focus. */
  current: string | undefined
  /** Everything on the list; their feeds are read too, so the switcher can
   *  show which other projects an agent has touched. */
  projects: Project[]
  /** Whether to read the other projects' feeds at all. */
  includeOthers: boolean
}

/**
 * Unread badges, driven by `todomd changes`: the server reports what other
 * writers (an agent, the TUI, a git pull) did since this browser last looked,
 * and drops the changes the UI made itself. Reading the feed advances that
 * project's cursor, so the marks are kept here — in localStorage — until the
 * card is opened.
 */
export function useUnread({ current, projects, includeOthers }: UnreadOptions) {
  const [unread, setUnread] = useState<UnreadState>(load)
  const applied = useRef(new Set<ChangeEvent[]>())

  // Every project's feed is a query of its own: the current one refetches on
  // focus like the board does, the rest only when the list or window wakes up.
  const feeds = useQueries({
    queries: projects
      .filter((p) => p.available && (includeOthers || p.id === current))
      .map((p) => ({
        queryKey: ['changes', p.id],
        queryFn: () => api.changes(p.id),
        refetchOnWindowFocus: p.id === current,
        staleTime: p.id === current ? 2_000 : 30_000,
      })),
  })

  // The effect below has to run when a feed *fetches*, not on every render;
  // dataUpdatedAt changes exactly then.
  const signature = feeds.map((f) => `${f.data?.project ?? ''}@${f.dataUpdatedAt}`).join('|')
  const payloads = useMemo(
    () => feeds.map((f) => f.data).filter((d) => d !== undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  )

  useEffect(() => {
    const fresh = payloads.filter((p) => p.events.length > 0 && !applied.current.has(p.events))
    if (fresh.length === 0) return
    fresh.forEach((p) => applied.current.add(p.events))
    setUnread((prev) => {
      const next = { ...prev }
      for (const payload of fresh) {
        const marks = { ...(next[payload.project] ?? {}) }
        for (const event of payload.events) {
          const kind = kindOf(event)
          if (!kind) {
            delete marks[event.task]
            continue
          }
          // "new" outranks "changed": a card you have never seen stays new.
          marks[event.task] = marks[event.task] === 'new' ? 'new' : kind
        }
        next[payload.project] = marks
      }
      return next
    })
  }, [payloads])

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(unread))
  }, [unread])

  const markRead = useCallback(
    (project: string, id: string) => {
      setUnread((prev) => {
        if (!prev[project]?.[id]) return prev
        const marks = { ...prev[project] }
        delete marks[id]
        return { ...prev, [project]: marks }
      })
    },
    [],
  )

  const markAllRead = useCallback((project: string) => {
    setUnread((prev) => ({ ...prev, [project]: {} }))
  }, [])

  /** Renaming a project changes its id; carry its marks across rather than
   *  silently dropping them. */
  const renameProject = useCallback((from: string, to: string) => {
    setUnread((prev) => moveMarks(prev, from, to))
  }, [])

  const unreadOf = useCallback(
    (id: string) => (current ? unread[current]?.[id] : undefined),
    [unread, current],
  )

  const countFor = useCallback(
    (project: string) => Object.keys(unread[project] ?? {}).length,
    [unread],
  )

  return {
    unreadOf,
    markRead,
    markAllRead,
    renameProject,
    countFor,
    count: current ? countFor(current) : 0,
  }
}
