// Card mentions: a card's id written in another card's description or
// comments — `#9e41` or just `9e41`. Ids are four characters of [0-9a-z], so
// plenty of ordinary words look like one: only an id that names a card on the
// board is a mention, and the caller's `known` decides that.
//
// The same rules as todomd.online's, so both show the same "Mentioned in".
// They feed the Links section ("Mentioned in", with Make link) and the link
// picker ("Mentioned on this card" first); the text itself doesn't turn
// mentions into links here.

import type { Board, Task } from '@/api/types'

/**
 * A four-character id, with an optional `#`, standing on its own: not part
 * of a longer word or number (`abcd9e41`, `9e41x`, `x_9e41`), a path or file
 * name (`/9e41`, `9e41.md`, `a.9e41`), an email or a handle (`@9e41`), or a
 * hyphenated word (`well-9e41`). Ordinary punctuation around it is fine:
 * `(9e41)`, `9e41,`, `#9e41`, a sentence's last `9e41.` Ids are lower case,
 * so `This` is never one while `this` might be.
 */
const MENTION = /(?<![\p{L}\p{N}_#@/.\\-])(#?)([0-9a-z]{4})(?![\p{L}\p{N}_@-]|[./\\][\p{L}\p{N}_])/gu

// What Markdown does not read as text, roughly, blanked out (newlines kept)
// before scanning: fenced code, inline code, link and image destinations,
// autolinks and bare URLs.
const FENCE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm
const CODE_SPAN = /(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g
const LINK_DEST = /\]\([^)\s]*(?:\s+"[^"]*")?\)/g
const AUTOLINK = /<[a-z][a-z0-9+.-]*:[^\s<>]*>/gi
const BARE_URL = /\b(?:https?:\/\/|www\.)[^\s<]*/gi

const blank = (s: string) => s.replace(/[^\n]/g, ' ')

/** Raw Markdown with code and URLs blanked out, for scanning. */
export function proseOf(markdown: string): string {
  return markdown
    .replace(FENCE, blank)
    .replace(CODE_SPAN, blank)
    .replace(LINK_DEST, blank)
    .replace(AUTOLINK, blank)
    .replace(BARE_URL, blank)
}

function scan(text: string, known: (id: string) => boolean, into: Set<string>) {
  for (const m of text.matchAll(MENTION)) if (known(m[2])) into.add(m[2])
}

/** The ids of known cards a piece of raw Markdown mentions, each once. */
export function mentionedIds(markdown: string, known: (id: string) => boolean): Set<string> {
  const ids = new Set<string>()
  scan(markdown, known, ids)
  // Most text mentions nothing: only blank out code when something matched.
  if (ids.size === 0) return ids
  ids.clear()
  scan(proseOf(markdown), known, ids)
  return ids
}

/** The cards a card's description and comments mention, not itself. */
export function mentionsOn(task: Task, known: (id: string) => boolean): Set<string> {
  const others = (id: string) => id !== task.id && known(id)
  const ids = mentionedIds(task.description, others)
  for (const c of task.comments) for (const id of mentionedIds(c.text, others)) ids.add(id)
  return ids
}

/** The cards whose text mentions `id`, in board order. */
export function mentionedIn(boards: readonly Board[], id: string): Task[] {
  return boards
    .flatMap((b) => b.tasks)
    .filter((t) => t.id !== id && mentionsOn(t, (x) => x === id).has(id))
}
