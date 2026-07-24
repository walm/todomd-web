import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { ChangeEvent } from '@/api/types'

export type UnreadKind = 'new' | 'changed'

const KEY = 'todomd-web:unread'

function load(): Record<string, UnreadKind> {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Record<string, UnreadKind>) : {}
  } catch {
    return {}
  }
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

/**
 * Unread badges, driven by `todomd changes`: the server reports what other
 * writers (an agent, the TUI, a git pull) did since this browser last looked,
 * and drops the changes the UI made itself. Reading the feed advances the
 * cursor, so the marks are kept here — in localStorage — until the card is
 * opened.
 */
export function useUnread() {
  const [unread, setUnread] = useState<Record<string, UnreadKind>>(load)
  const applied = useRef<ChangeEvent[] | null>(null)

  const { data } = useQuery({
    queryKey: ['changes'],
    queryFn: api.changes,
    // Sharing the board's refetch triggers keeps badges in step with content.
    refetchOnWindowFocus: true,
    staleTime: 2_000,
  })

  useEffect(() => {
    if (!data || data.events.length === 0 || applied.current === data.events) return
    applied.current = data.events
    setUnread((prev) => {
      const next = { ...prev }
      for (const event of data.events) {
        const kind = kindOf(event)
        if (!kind) {
          delete next[event.task]
          continue
        }
        // "new" outranks "changed": a card you have never seen stays new.
        next[event.task] = next[event.task] === 'new' ? 'new' : kind
      }
      return next
    })
  }, [data])

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(unread))
  }, [unread])

  const markRead = useCallback((id: string) => {
    setUnread((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const markAllRead = useCallback(() => setUnread({}), [])

  const unreadOf = useCallback((id: string) => unread[id], [unread])

  return { unreadOf, markRead, markAllRead, count: Object.keys(unread).length }
}
