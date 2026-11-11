import { describe, expect, it } from 'vitest'
import type { Board, Link, Task } from '@/api/types'
import { isBlocked, lastBoard, linkMarks, linksSupported } from './links'

const task = (id: string, board: string, links?: Link[] | null): Task => ({
  id,
  board,
  title: id,
  tags: [],
  priority: 'normal',
  due: null,
  description: '',
  comments: [],
  links,
})

const blockedBy = (id: string, board: string | null): Link => ({
  kind: 'blocked by',
  id,
  title: board === null ? null : id,
  board,
  stored_on: id,
})

describe('links', () => {
  it('knows a todomd that predates links by the missing field', () => {
    expect(linksSupported([{ name: 'B', tasks: [task('a', 'B', [])] }])).toBe(true)
    expect(linksSupported([{ name: 'B', tasks: [task('a', 'B', []), task('b', 'B')] }])).toBe(false)
    expect(linksSupported([{ name: 'B', tasks: [task('a', 'B', null)] }])).toBe(false)
    expect(linksSupported([{ name: 'B', tasks: [] }])).toBe(true)
  })

  it('is blocked only by a card still open on the board', () => {
    const boards: Board[] = [{ name: 'Backlog', tasks: [] }, { name: 'Done', tasks: [] }]
    const last = lastBoard(boards)
    expect(last).toBe('Done')
    expect(isBlocked(task('a', 'Backlog', [blockedBy('b', 'Backlog')]), last)).toBe(true)
    expect(isBlocked(task('a', 'Backlog', [blockedBy('b', 'Done')]), last)).toBe(false)
    expect(isBlocked(task('a', 'Backlog', [blockedBy('b', null)]), last)).toBe(false)
    expect(
      isBlocked(
        task('a', 'Backlog', [{ kind: 'blocks', id: 'b', title: 'b', board: 'Backlog', stored_on: 'a' }]),
        last,
      ),
    ).toBe(false)
  })

  it('marks a card with its link count, and nothing without links', () => {
    expect(linkMarks(task('a', 'Backlog', []), 'Done')).toBeNull()
    expect(linkMarks(task('a', 'Backlog'), 'Done')).toBeNull()
    expect(
      linkMarks(task('a', 'Backlog', [blockedBy('b', 'Backlog'), blockedBy('c', 'Done')]), 'Done'),
    ).toEqual({ count: 2, blocked: true })
  })
})
