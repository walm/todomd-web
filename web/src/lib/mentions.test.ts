import { describe, expect, it } from 'vitest'
import type { Board, Task } from '@/api/types'
import { mentionedIds, mentionedIn, mentionsOn } from './mentions'

const known = (...ids: string[]) => (id: string) => ids.includes(id)

const task = (id: string, description = '', comments: string[] = []): Task => ({
  id,
  board: 'Backlog',
  title: `Card ${id}`,
  tags: [],
  priority: 'normal',
  due: null,
  description,
  comments: comments.map((text) => ({ author: 'agent', date: '2026-11-11', text })),
  links: [],
})

describe('mentions', () => {
  it('finds ids on their own, with or without #', () => {
    const ids = mentionedIds('Split from #9e41; see (3f2a), and 7dai.', known('9e41', '3f2a', '7dai'))
    expect([...ids].sort()).toEqual(['3f2a', '7dai', '9e41'])
  })

  it('ignores ids that are not cards, or part of something else', () => {
    const k = known('9e41')
    expect(mentionedIds('abcd9e41 9e41x x_9e41 /9e41 9e41.md @9e41 well-9e41', k).size).toBe(0)
    expect(mentionedIds('This is 9E41', k).size).toBe(0)
    expect(mentionedIds('look at that', k).size).toBe(0)
  })

  it('skips code and URLs', () => {
    const k = known('9e41')
    expect(mentionedIds('`9e41` and\n```\n9e41\n```\nhttps://x.dev/9e41 [a](9e41)', k).size).toBe(0)
    expect(mentionedIds('`code` then 9e41', k).has('9e41')).toBe(true)
  })

  it("reads a card's description and comments, not its own id", () => {
    const t = task('aaaa', 'after bbbb', ['and #cccc, not aaaa'])
    expect([...mentionsOn(t, known('aaaa', 'bbbb', 'cccc'))].sort()).toEqual(['bbbb', 'cccc'])
  })

  it('lists the cards that mention one, in board order', () => {
    const boards: Board[] = [
      { name: 'Backlog', tasks: [task('aaaa', 'see dddd'), task('bbbb', 'nothing')] },
      { name: 'Done', tasks: [task('cccc', '', ['#dddd done']), task('dddd', 'dddd itself')] },
    ]
    expect(mentionedIn(boards, 'dddd').map((t) => t.id)).toEqual(['aaaa', 'cccc'])
  })
})
