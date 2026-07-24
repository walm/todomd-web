import { afterEach, describe, expect, it, vi } from 'vitest'
import { daysUntil, dueUrgency, formatDue } from './due'

// Due dates are calendar dates, so "today" must be decided in local time —
// a UTC-based comparison would flip the badge for anyone west of Greenwich.
const freeze = (iso: string) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

afterEach(() => vi.useRealTimers())

describe('due dates', () => {
  it('counts whole days, locally', () => {
    freeze('2026-07-24T23:30:00')
    expect(daysUntil('2026-07-24')).toBe(0)
    expect(daysUntil('2026-07-25')).toBe(1)
    expect(daysUntil('2026-07-23')).toBe(-1)
  })

  it('flags overdue and imminent dates', () => {
    freeze('2026-07-24T09:00:00')
    expect(dueUrgency('2026-07-23')).toBe('overdue')
    expect(dueUrgency('2026-07-24')).toBe('soon')
    expect(dueUrgency('2026-07-26')).toBe('soon')
    expect(dueUrgency('2026-08-30')).toBe('later')
  })

  it('labels near dates in words', () => {
    freeze('2026-07-24T09:00:00')
    expect(formatDue('2026-07-24')).toBe('today')
    expect(formatDue('2026-07-25')).toBe('tomorrow')
    expect(formatDue('2026-07-23')).toBe('yesterday')
    expect(formatDue('2026-07-20')).toBe('4d overdue')
  })

  it('passes unparseable dates through untouched', () => {
    expect(formatDue('someday')).toBe('someday')
  })
})
