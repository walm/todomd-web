/** Inserts an attachment's markdown where the caret was, on a line of its
 *  own: an image in the middle of a sentence renders as a broken paragraph,
 *  and a link on its own line reads better in the file too. Returns the new
 *  text and where the caret should land — just after the inserted link. */
export function insertSnippet(
  text: string,
  start: number,
  end: number,
  snippet: string,
): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, text.length))
  const to = Math.max(from, Math.min(end, text.length))
  const before = text.slice(0, from)
  const after = text.slice(to)
  const lead = before === '' || before.endsWith('\n') ? '' : '\n'
  const trail = after === '' || after.startsWith('\n') ? '' : '\n'
  return {
    text: before + lead + snippet + trail + after,
    caret: before.length + lead.length + snippet.length,
  }
}

/** Maps a link to an attached file onto the API route that serves it. An
 *  attachment is linked in the file by its absolute path — that is what an
 *  agent can open — so a path under this project's attachment root is one.
 *  Returns null for anything else, which the caller treats as it would any
 *  link. Nothing here imports the markdown parser: this module is used by the
 *  editor, which is on the board's first paint, and the parser is not. */
export function attachmentUrl(url: string, project: string, root?: string): string | null {
  if (root) {
    // The markdown pipeline percent-encodes spaces and non-ASCII characters
    // before a URL gets here; the root is a plain path.
    let path = url
    try {
      path = decodeURI(url)
    } catch {
      // not valid percent-encoding; compare it as written
    }
    const prefix = root.endsWith('/') ? root : `${root}/`
    if (path.startsWith(prefix)) {
      const rest = path.slice(prefix.length).split('/')
      if (rest.length === 2 && rest.every(Boolean)) {
        const [task, name] = rest
        return `/api/projects/${encodeURIComponent(project)}/attachments/${encodeURIComponent(task)}/${encodeURIComponent(name)}`
      }
    }
  }
  return null
}

/** A draft id for a task still being written. getRandomValues rather than
 *  randomUUID, which a page served over plain http to another host lacks. */
export function newDraftId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

/** A human size for the too-large message. */
export function formatBytes(n: number): string {
  if (n >= 1 << 20) return `${Math.round((n / (1 << 20)) * 10) / 10} MB`
  if (n >= 1 << 10) return `${Math.round(n / (1 << 10))} KB`
  return `${n} bytes`
}
