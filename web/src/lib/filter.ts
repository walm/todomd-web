import type { Board } from '@/api/types'

/** Filters on everything visible on a card, plus the id and description —
 *  what you would otherwise grep the file for. All terms must match. */
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
