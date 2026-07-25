import { describe, expect, it } from 'vitest'
import { migrate } from './use-unread'

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
