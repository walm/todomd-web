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

/** Applies a feed to one project's marks, the way the board badges cards:
 *  added is new, anything else done to a card is changed, and a card you have
 *  never seen stays new. A deleted card has nothing left to badge. */
export function fold(
  marks: Record<string, UnreadKind> | undefined,
  events: ChangeEvent[],
): Record<string, UnreadKind> {
  const next = { ...(marks ?? {}) }
  for (const event of events) {
    const kind = kindOf(event)
    if (!kind) {
      delete next[event.task]
      continue
    }
    next[event.task] = next[event.task] === 'new' ? 'new' : kind
  }
  return next
}

/** How many cards in a project are waiting to be looked at, and how many of
 *  those are new. */
export interface UnreadSummary {
  count: number
  fresh: number
}

export const NOTHING_UNREAD: UnreadSummary = { count: 0, fresh: 0 }

export function summarize(marks: Record<string, UnreadKind> | undefined): UnreadSummary {
  const kinds = Object.values(marks ?? {})
  return { count: kinds.length, fresh: kinds.filter((k) => k === 'new').length }
}

/** Several projects' counts as one, for the switcher button. */
export function total(summaries: UnreadSummary[]): UnreadSummary {
  return summaries.reduce(
    (sum, s) => ({ count: sum.count + s.count, fresh: sum.fresh + s.fresh }),
    NOTHING_UNREAD,
  )
}

/** The colour a count wears, matching the card badges: green if any card it
 *  counts is new, amber if they are only changed, nothing when it is zero. */
export function toneOf(summary: UnreadSummary): UnreadKind | null {
  if (summary.count === 0) return null
  return summary.fresh > 0 ? 'new' : 'changed'
}

/** Says what a count is made of, for its tooltip and screen readers. */
export function describeUnread({ count, fresh }: UnreadSummary): string {
  const changed = count - fresh
  const parts = [fresh > 0 && `${fresh} new`, changed > 0 && `${changed} changed`].filter(Boolean)
  return `${parts.join(', ')} since you last looked`
}

export interface UnreadOptions {
  /** The project on screen; its feed is read on every focus, and on the
   *  same timer as its board so badges appear with the cards they mark. */
  current: string | undefined
  /** Refresh interval in ms for the current project, 0 when off. */
  pollMs?: number
  /** Everything on the list; the others are peeked at too, so the switcher
   *  can show which of them an agent has touched. */
  projects: Project[]
  /** Whether to peek at the other projects at all. */
  includeOthers: boolean
}

// How long another project's count is trusted before a focus asks again. A
// project over ssh is an ssh round trip per peek, so it is asked less often.
const PEEK_STALE_LOCAL = 15_000
const PEEK_STALE_REMOTE = 60_000

/**
 * Unread badges, driven by `todomd changes`: the server reports what other
 * writers (an agent, the TUI, a git pull) did since this browser last looked,
 * and drops the changes the UI made itself. Reading the open project's feed
 * advances its cursor, so its marks are kept here — in localStorage — until
 * the card is opened.
 *
 * The other projects are only peeked at: their counts are what their boards
 * would badge if opened now — the marks kept here plus whatever is still
 * waiting on the cursor — and the events stay there until you do open one,
 * in this browser or another. Peeks run on load and on focus, never on a
 * timer, and each is its own request, so a slow ssh project only leaves its
 * own count missing for a while.
 */
export function useUnread({ current, projects, includeOthers, pollMs = 0 }: UnreadOptions) {
  const [unread, setUnread] = useState<UnreadState>(load)
  const applied = useRef(new Set<ChangeEvent[]>())

  // Only the open project's feed is read for real; it refetches on focus and
  // on the same timer as its board, so badges appear with the cards they mark.
  const feeds = useQueries({
    queries: projects
      .filter((p) => p.available && p.id === current)
      .map((p) => ({
        queryKey: ['changes', p.id],
        queryFn: () => api.changes(p.id),
        refetchInterval: pollMs > 0 ? pollMs : false,
      })),
  })

  // A project's peek from before you opened it is wrong once you have: its
  // events are marks here now, some of them read. So every visit starts a
  // new generation of its peek, and leaving asks afresh. Bumped while
  // rendering, so not even one frame shows the old count.
  const [visits, setVisits] = useState({ current, gen: {} as Record<string, number> })
  if (visits.current !== current) {
    const gen = { ...visits.gen }
    if (visits.current) gen[visits.current] = (gen[visits.current] ?? 0) + 1
    setVisits({ current, gen })
  }

  const others = useMemo(
    () => projects.filter((p) => p.available && p.id !== current && includeOthers),
    [projects, current, includeOthers],
  )
  const peeks = useQueries({
    queries: others.map((p) => ({
      queryKey: ['peek', p.id, visits.gen[p.id] ?? 0],
      queryFn: () => api.peek(p.id),
      staleTime: p.host ? PEEK_STALE_REMOTE : PEEK_STALE_LOCAL,
      // A count that does not come is fine; hammering a dead host is not.
      retry: false,
    })),
  })
  const peekSignature = peeks
    .map((q) => `${q.data?.project ?? ''}@${q.dataUpdatedAt}`)
    .join('|')
  const peeked = useMemo(
    () =>
      Object.fromEntries(
        peeks.flatMap((q) => (q.data ? [[q.data.project, q.data.events]] : [])),
      ) as Record<string, ChangeEvent[]>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [peekSignature],
  )

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
      for (const payload of fresh) next[payload.project] = fold(next[payload.project], payload.events)
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

  /** What a project's board would badge if you opened it now. */
  const countFor = useCallback(
    (project: string): UnreadSummary =>
      summarize(
        project === current ? unread[project] : fold(unread[project], peeked[project] ?? []),
      ),
    [unread, peeked, current],
  )

  return {
    unreadOf,
    markRead,
    markAllRead,
    renameProject,
    countFor,
    count: current ? countFor(current).count : 0,
  }
}
