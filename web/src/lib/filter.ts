import type { Board, Priority } from '@/api/types'

const PRIORITIES: Priority[] = ['high', 'normal', 'low']

/**
 * Filters on everything visible on a card, plus the id and description —
 * what you would otherwise grep the file for. All terms must match.
 *
 * A `priority:high` term (or the bare `!high`) filters by priority instead of
 * text, because "high" on its own should still find a task *called* "high
 * contrast", and because a busy board is exactly where you want to see the
 * urgent things only. Mirrors `todomd list --priority`.
 */
export function filterBoards(boards: Board[], query: string): Board[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return boards

  const terms: string[] = []
  const priorities: Priority[] = []
  for (const term of needle.split(/\s+/)) {
    const named = /^(?:priority:|!)(high|normal|low)$/.exec(term)
    if (named) priorities.push(named[1] as Priority)
    else terms.push(term)
  }

  return boards.map((board) => ({
    ...board,
    tasks: board.tasks.filter((task) => {
      if (priorities.length > 0 && !priorities.includes(task.priority)) return false
      const haystack = [task.title, task.description, task.id, ...task.tags]
        .join(' ')
        .toLowerCase()
      return terms.every((term) => haystack.includes(term))
    }),
  }))
}

/** The priorities a query names, for the UI to echo back. */
export function queryPriorities(query: string): Priority[] {
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map((term) => /^(?:priority:|!)(high|normal|low)$/.exec(term)?.[1] as Priority | undefined)
    .filter((p): p is Priority => !!p && PRIORITIES.includes(p))
}
