// Card stickers (todomd v0.15.0+): one per card, an emoji from a fixed set or
// a coloured corner ribbon. The file stores the name (`<!-- sticker: fire -->`);
// the names and their order are the CLI's (`todomd sticker --json`).

import type { Board, StickerName, Task } from '@/api/types'

export interface Sticker {
  name: StickerName
  kind: 'emoji' | 'ribbon'
  /** The emoji; empty for a ribbon. */
  emoji: string
}

const emoji = (name: StickerName, e: string): Sticker => ({ name, kind: 'emoji', emoji: e })
const ribbon = (name: StickerName): Sticker => ({ name, kind: 'ribbon', emoji: '' })

export const EMOJI_STICKERS: readonly Sticker[] = [
  emoji('fire', '🔥'),
  emoji('star', '⭐'),
  emoji('eyes', '👀'),
  emoji('wip', '🚧'),
  emoji('check', '✅'),
  emoji('target', '🎯'),
  emoji('zap', '⚡'),
  emoji('idea', '💡'),
  emoji('bug', '🐛'),
  emoji('ship', '🚀'),
  emoji('question', '❓'),
  emoji('heart', '❤️'),
]

export const RIBBONS: readonly Sticker[] = [
  ribbon('red'),
  ribbon('amber'),
  ribbon('green'),
  ribbon('blue'),
  ribbon('violet'),
]

export const STICKERS: readonly Sticker[] = [...EMOJI_STICKERS, ...RIBBONS]

const byName = new Map(STICKERS.map((s) => [s.name, s]))

/** The sticker a card carries, if it is one this UI knows. */
export function stickerOf(task: Pick<Task, 'sticker'>): Sticker | undefined {
  return task.sticker ? byName.get(task.sticker) : undefined
}

/** Whether the installed todomd reports stickers at all: one older than
 *  v0.15.0 leaves the field out. A board with no cards can't tell, and needs
 *  no stickers either. */
export function stickersSupported(boards: readonly Board[]): boolean {
  return boards.every((b) => b.tasks.every((t) => t.sticker !== undefined))
}

/** Emoji without the variation selector, so ❤️ and ❤ are the same heart. */
const bare = (s: string) => s.replace(/️/g, '')

/**
 * What a `sticker:` filter term names, as `todomd list --sticker` reads it: a
 * name or its emoji, `any`, or `none`. Undefined for anything else.
 */
export function parseStickerTerm(value: string): StickerName | 'any' | 'none' | undefined {
  const v = bare(value.trim().toLowerCase())
  if (v === 'any' || v === 'none') return v
  return STICKERS.find((s) => s.name === v || (s.emoji && bare(s.emoji) === v))?.name
}

/** A ribbon's colour, for the corner band and the picker's swatches. */
export const RIBBON_COLOR: Record<string, string> = {
  red: 'bg-red-500',
  amber: 'bg-amber-400',
  green: 'bg-emerald-500',
  blue: 'bg-sky-500',
  violet: 'bg-violet-500',
}

/** How a sticker reads in words: "fire", "red ribbon". */
export const stickerLabel = (s: Sticker) => (s.kind === 'ribbon' ? `${s.name} ribbon` : s.name)
