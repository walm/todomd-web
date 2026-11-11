// Card links as the board shows them. todomd (v0.14.0+) already computes
// both directions for every card in `list --json`, with the other card's
// title and board, so nothing here works out an inverse: it only decides
// what a link looks like and what it means for the card.

import type { Board, Link, LinkKind, Task } from '@/api/types'

export const LINK_LABEL: Record<LinkKind, string> = {
  'split from': 'Split from',
  'split into': 'Split into',
  blocks: 'Blocks',
  'blocked by': 'Blocked by',
  related: 'Related',
  'duplicate of': 'Duplicate of',
  'duplicated by': 'Duplicated by',
}

/** The kinds the picker offers; "duplicated by" is what the other card says. */
export const PICK_KINDS: readonly LinkKind[] = [
  'related',
  'blocks',
  'blocked by',
  'split from',
  'split into',
  'duplicate of',
]

/** Whether the installed todomd reports links at all: one older than
 *  v0.14.0 leaves the field out. A board with no cards can't tell, and
 *  needs no links either. */
export function linksSupported(boards: readonly Board[]): boolean {
  return boards.every((b) => b.tasks.every((t) => Array.isArray(t.links)))
}

/** The last board, Done usually: a card there is finished. */
export function lastBoard(boards: readonly Board[]): string | undefined {
  return boards[boards.length - 1]?.name
}

/** A link's other card is finished: it is on the last board. */
export const linkDone = (link: Link, last: string | undefined) =>
  link.board !== null && link.board === last

/** Blocked by a card that is still open (on the board, not on the last one). */
export function isBlocked(task: Task, last: string | undefined): boolean {
  return (task.links ?? []).some(
    (l) => l.kind === 'blocked by' && l.board !== null && l.board !== last,
  )
}

/** What a board card shows: its link count, and whether it is blocked. */
export function linkMarks(
  task: Task,
  last: string | undefined,
): { count: number; blocked: boolean } | null {
  const count = task.links?.length ?? 0
  if (count === 0) return null
  return { count, blocked: isBlocked(task, last) }
}
