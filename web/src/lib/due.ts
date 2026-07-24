/** Due dates are plain calendar dates ("2026-08-01"), so they are compared
 *  against the local day, never against a timestamp. */

function startOfToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export function parseDue(due: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function daysUntil(due: string): number | null {
  const date = parseDue(due)
  if (!date) return null
  return Math.round((date.getTime() - startOfToday().getTime()) / 86_400_000)
}

export type DueUrgency = 'overdue' | 'soon' | 'later'

export function dueUrgency(due: string): DueUrgency {
  const days = daysUntil(due)
  if (days === null) return 'later'
  if (days < 0) return 'overdue'
  if (days <= 2) return 'soon'
  return 'later'
}

/** A short, human label: "overdue", "today", "tomorrow", "Fri", "12 Aug". */
export function formatDue(due: string): string {
  const days = daysUntil(due)
  const date = parseDue(due)
  if (days === null || !date) return due
  if (days < -1) return `${Math.abs(days)}d overdue`
  if (days === -1) return 'yesterday'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'short' })
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
