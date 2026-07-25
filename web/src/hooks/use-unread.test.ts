import { describe, expect, it } from 'vitest'
import { migrate, moveMarks } from './use-unread'

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
