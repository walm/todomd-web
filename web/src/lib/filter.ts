import type { Board, Priority } from '@/api/types'
import { isBlocked, lastBoard } from '@/lib/links'
import { parseStickerTerm } from '@/lib/stickers'

const PRIORITIES: Priority[] = ['high', 'normal', 'low']

/**
 * Filters on everything visible on a card, plus the id and description —
 * what you would otherwise grep the file for. All terms must match.
 *
 * A `priority:high` term (or the bare `!high`) filters by priority instead of
 * text, because "high" on its own should still find a task *called* "high
 * contrast", and because a busy board is exactly where you want to see the
 * urgent things only. Mirrors `todomd list --priority`.
 *
 * `is:blocked` keeps the cards blocked by a card that is still open, and
 * `link:9e41` the cards linked to 9e41 (either way, any kind).
 *
 * `sticker:fire` (or `sticker:🔥`, `sticker:red`) keeps the cards with that
 * sticker, `has:sticker` or `sticker:any` the ones with any, `sticker:none`
 * the ones without — as `todomd list --sticker` reads it.
 */
export function filterBoards(boards: Board[], query: string): Board[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return boards

  const terms: string[] = []
  const priorities: Priority[] = []
  const linkedTo: string[] = []
  const stickers: string[] = []
  let blocked = false
  for (const term of needle.split(/\s+/)) {
    const named = /^(?:priority:|!)(high|normal|low)$/.exec(term)
    const link = /^link:#?([0-9a-z]{1,4})$/.exec(term)
    const sticker = term.startsWith('sticker:') ? parseStickerTerm(term.slice(8)) : undefined
    if (named) priorities.push(named[1] as Priority)
    else if (link) linkedTo.push(link[1])
    else if (sticker) stickers.push(sticker)
    else if (term === 'has:sticker') stickers.push('any')
    else if (term === 'is:blocked') blocked = true
    else terms.push(term)
  }
  const last = lastBoard(boards)

  return boards.map((board) => ({
    ...board,
    tasks: board.tasks.filter((task) => {
      if (priorities.length > 0 && !priorities.includes(task.priority)) return false
      if (blocked && !isBlocked(task, last)) return false
      if (!stickers.every((want) => stickerMatches(task.sticker, want))) return false
      const links = task.links ?? []
      if (!linkedTo.every((id) => links.some((l) => l.id.startsWith(id)))) return false
      const haystack = [task.title, task.description, task.id, ...task.tags]
        .join(' ')
        .toLowerCase()
      return terms.every((term) => haystack.includes(term))
    }),
  }))
}

function stickerMatches(sticker: string | null | undefined, want: string): boolean {
  if (want === 'any') return !!sticker
  if (want === 'none') return !sticker
  return sticker === want
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
