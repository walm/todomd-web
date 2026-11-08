import { describe, expect, it } from 'vitest'
import type { ChangeEvent, ChangeType } from '@/api/types'
import { describeUnread, fold, migrate, moveMarks, summarize, toneOf, total } from './use-unread'

const ev = (type: ChangeType, task: string): ChangeEvent => ({
  type,
  task,
  title: task,
  board: 'Backlog',
})

describe('unread store migration', () => {
  it('files a pre-projects store under the project on screen', () => {
    // Before projects the store was flat: { taskId: kind }. Losing those marks
    // on upgrade would badge nothing, silently.
    window.history.replaceState(null, '', '/p/todomd-web')
    expect(migrate({ '3f2a': 'new', 'b1c2': 'changed' })).toEqual({
      'todomd-web': { '3f2a': 'new', b1c2: 'changed' },
    })
  })

  it('leaves an already-scoped store alone', () => {
    const scoped = { alpha: { '3f2a': 'new' as const }, beta: {} }
    expect(migrate(scoped)).toEqual(scoped)
  })

  it('handles an empty store', () => {
    expect(migrate({})).toEqual({})
  })
})

describe('renaming a project', () => {
  it('carries its unread marks to the new id', () => {
    const before = { 'docs-2': { '3f2a': 'new' as const }, alpha: {} }
    expect(moveMarks(before, 'docs-2', 'house')).toEqual({
      alpha: {},
      house: { '3f2a': 'new' },
    })
  })

  it('merges when the new id already has marks', () => {
    const before = { a: { x: 'new' as const }, b: { y: 'changed' as const } }
    expect(moveMarks(before, 'a', 'b')).toEqual({ b: { y: 'changed', x: 'new' } })
  })

  it('does nothing when the id is unchanged or unknown', () => {
    const before = { a: { x: 'new' as const } }
    expect(moveMarks(before, 'a', 'a')).toBe(before)
    expect(moveMarks(before, 'zzz', 'b')).toBe(before)
  })
})

describe('counting what a board would badge', () => {
  it('counts added cards as new and anything else done to a card as changed', () => {
    const marks = fold({}, [
      ev('task_added', 'a'),
      ev('task_updated', 'b'),
      ev('task_moved', 'c'),
      ev('comment_added', 'd'),
    ])
    expect(marks).toEqual({ a: 'new', b: 'changed', c: 'changed', d: 'changed' })
    expect(summarize(marks)).toEqual({ count: 4, fresh: 1 })
  })

  it('counts a card once, however often it changed, and keeps it new', () => {
    const marks = fold({}, [ev('task_added', 'a'), ev('task_moved', 'a'), ev('comment_added', 'a')])
    expect(summarize(marks)).toEqual({ count: 1, fresh: 1 })
  })

  it('adds a peek to the marks already kept, without counting a card twice', () => {
    // Marks from an earlier visit are still unread; the peek adds what an
    // agent did since, one of them to a card already marked.
    const kept = { a: 'changed' as const, b: 'new' as const }
    const marks = fold(kept, [ev('task_updated', 'b'), ev('task_added', 'c')])
    expect(marks).toEqual({ a: 'changed', b: 'new', c: 'new' })
    expect(kept).toEqual({ a: 'changed', b: 'new' }) // left alone
  })

  it('drops a deleted card: there is nothing left to look at', () => {
    const marks = fold({ a: 'changed' }, [
      ev('task_added', 'b'),
      ev('task_deleted', 'b'),
      ev('task_deleted', 'a'),
    ])
    expect(summarize(marks)).toEqual({ count: 0, fresh: 0 })
  })
})

describe('the colour of a count', () => {
  it('is green when any counted card is new', () => {
    expect(toneOf({ count: 3, fresh: 1 })).toBe('new')
  })

  it('is amber when the cards are only changed', () => {
    expect(toneOf({ count: 3, fresh: 0 })).toBe('changed')
  })

  it('is nothing at zero', () => {
    expect(toneOf({ count: 0, fresh: 0 })).toBeNull()
  })

  it('on the switcher button, is green if any other project has a new card', () => {
    const sum = total([
      { count: 2, fresh: 0 },
      { count: 1, fresh: 1 },
      { count: 0, fresh: 0 },
    ])
    expect(sum).toEqual({ count: 3, fresh: 1 })
    expect(toneOf(sum)).toBe('new')
    expect(toneOf(total([{ count: 2, fresh: 0 }, { count: 4, fresh: 0 }]))).toBe('changed')
    expect(toneOf(total([]))).toBeNull()
  })

  it('says what it is made of', () => {
    expect(describeUnread({ count: 3, fresh: 1 })).toBe('1 new, 2 changed since you last looked')
    expect(describeUnread({ count: 2, fresh: 0 })).toBe('2 changed since you last looked')
    expect(describeUnread({ count: 1, fresh: 1 })).toBe('1 new since you last looked')
  })
})
