import { describe, expect, it } from 'vitest'
import { pathFor, readLocation } from './location'

describe('routes', () => {
  it('reads a project and an open task', () => {
    expect(readLocation('/p/todomd-web')).toEqual({ project: 'todomd-web', task: null })
    expect(readLocation('/p/todomd-web/t/3f2a')).toEqual({
      project: 'todomd-web',
      task: '3f2a',
    })
    expect(readLocation('/p/todomd-web/')).toEqual({ project: 'todomd-web', task: null })
  })

  it('still understands links from before projects existed', () => {
    // /t/3f2a used to be the only task URL; it resolves against whichever
    // project the app settles on rather than 404ing in the browser.
    expect(readLocation('/t/3f2a')).toEqual({ project: null, task: '3f2a' })
  })

  it('treats anything else as the default board', () => {
    expect(readLocation('/')).toEqual({ project: null, task: null })
    expect(readLocation('/p/')).toEqual({ project: null, task: null })
    expect(readLocation('/nonsense/path')).toEqual({ project: null, task: null })
  })

  it('round-trips names that need escaping', () => {
    const path = pathFor({ project: 'my project', task: '3f2a' })
    expect(path).toBe('/p/my%20project/t/3f2a')
    expect(readLocation(path)).toEqual({ project: 'my project', task: '3f2a' })
  })

  it('builds paths', () => {
    expect(pathFor({ project: 'a', task: null })).toBe('/p/a')
    expect(pathFor({ project: null, task: null })).toBe('/')
  })
})
