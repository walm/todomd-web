import type { Board } from '@/api/types'

export interface TagCount {
  tag: string
  count: number
}

/** Every tag on the loaded board with the number of cards using it, most used
 *  first (ties alphabetical). Matching is case-insensitive, so the first
 *  spelling seen stands for the rest. */
export function countTags(boards: Board[]): TagCount[] {
  const seen = new Map<string, TagCount>()
  for (const board of boards) {
    for (const task of board.tasks) {
      for (const raw of new Set(task.tags.map((t) => t.replace(/^#/, '').toLowerCase()))) {
        if (!raw) continue
        const tag = task.tags.find((t) => t.replace(/^#/, '').toLowerCase() === raw)!.replace(/^#/, '')
        const hit = seen.get(raw)
        if (hit) hit.count++
        else seen.set(raw, { tag, count: 1 })
      }
    }
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

export type TagMode = 'tags' | 'filter'

/** The word being typed at the caret, and where it sits in the value. In a
 *  tags field any word counts; in the filter box only one that starts with
 *  `#` or `tag:` does, and `word` is what follows that prefix. `start` is the
 *  first character of `word`, so replacing [start, end) swaps just the tag. */
export interface Word {
  word: string
  start: number
  end: number
}

export function wordAt(value: string, caret: number, mode: TagMode): Word | null {
  const sep = mode === 'tags' ? /[\s,]/ : /\s/
  let start = caret
  while (start > 0 && !sep.test(value[start - 1])) start--
  let end = caret
  while (end < value.length && !sep.test(value[end])) end++
  const token = value.slice(start, end)
  if (mode === 'tags') {
    const lead = token.startsWith('#') ? 1 : 0
    return { word: token.slice(lead), start: start + lead, end }
  }
  const prefix = /^(?:#|tag:#?)/i.exec(token)
  if (!prefix) return null
  return { word: token.slice(prefix[0].length), start: start + prefix[0].length, end }
}

export interface Suggestion {
  tag: string
  /** Cards using it; absent on the "Create" row. */
  count?: number
  create?: boolean
}

/** Existing tags matching `word` — prefix matches first, then contains, each
 *  most-used first — minus `exclude`, plus a trailing Create row (tags mode)
 *  when nothing matches exactly. */
export function suggest(
  tags: TagCount[],
  word: string,
  opts: { exclude?: string[]; create?: boolean; limit?: number } = {},
): Suggestion[] {
  const needle = word.replace(/^#/, '').toLowerCase()
  const skip = new Set((opts.exclude ?? []).map((t) => t.replace(/^#/, '').toLowerCase()))
  const starts: Suggestion[] = []
  const has: Suggestion[] = []
  for (const { tag, count } of tags) {
    const low = tag.toLowerCase()
    if (skip.has(low)) continue
    if (low.startsWith(needle)) starts.push({ tag, count })
    else if (low.includes(needle)) has.push({ tag, count })
  }
  const out = [...starts, ...has].slice(0, opts.limit ?? 8)
  if (opts.create && needle) {
    const exact = tags.some((t) => t.tag.toLowerCase() === needle) || skip.has(needle)
    if (!exact) out.push({ tag: needle, create: true })
  }
  return out
}

/** The value with the word at [start, end) replaced by `tag` and a space after
 *  it, plus where the caret goes. */
export function applyTag(value: string, w: Word, tag: string): { value: string; caret: number } {
  const rest = value.slice(w.end).replace(/^[\s,]+/, '')
  const head = value.slice(0, w.start) + tag + ' '
  return { value: head + rest, caret: head.length }
}
