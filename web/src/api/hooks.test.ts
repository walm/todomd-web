import { describe, expect, it } from 'vitest'
import { applyMove } from './hooks'
import type { BoardResponse, Task } from './types'

const task = (id: string, board: string): Task => ({
  id,
  board,
  title: id,
  tags: [],
  priority: 'normal',
  due: null,
  description: '',
  comments: [],
})

const board = (): BoardResponse => ({
  project: 'demo',
  file: '/tmp/TODO.md',
  rev: '1',
  boards: [
    { name: 'Backlog', tasks: [task('a', 'Backlog'), task('b', 'Backlog'), task('c', 'Backlog')] },
    { name: 'Doing', tasks: [task('d', 'Doing')] },
    { name: 'Done', tasks: [] },
  ],
})

const titles = (b: BoardResponse) =>
  b.boards.map((column) => `${column.name}: ${column.tasks.map((t) => t.id).join(',')}`)

/**
 * The optimistic move has to land the card exactly where todomd will put it,
 * or the board visibly jumps when the refetch arrives. `pos` is 1-based in
 * the target board *after* the task is removed — the same index a drop
 * target reports, which is what the server-side test pins down.
 */
describe('applyMove', () => {
  it('reorders downwards within a board', () => {
    const next = applyMove(board(), { id: 'a', to: 'Backlog', pos: 3 })
    expect(titles(next)[0]).toBe('Backlog: b,c,a')
  })

  it('reorders upwards within a board', () => {
    const next = applyMove(board(), { id: 'c', to: 'Backlog', pos: 1 })
    expect(titles(next)[0]).toBe('Backlog: c,a,b')
  })

  it('moves across boards at a position', () => {
    const next = applyMove(board(), { id: 'a', to: 'Doing', pos: 1 })
    expect(titles(next)).toEqual(['Backlog: b,c', 'Doing: a,d', 'Done: '])
    expect(next.boards[1].tasks[0].board).toBe('Doing')
  })

  it('appends when pos is 0 or past the end', () => {
    expect(titles(applyMove(board(), { id: 'a', to: 'Doing', pos: 0 }))[1]).toBe('Doing: d,a')
    expect(titles(applyMove(board(), { id: 'a', to: 'Doing', pos: 99 }))[1]).toBe('Doing: d,a')
  })

  it('moves into an empty board', () => {
    expect(titles(applyMove(board(), { id: 'b', to: 'Done', pos: 0 }))[2]).toBe('Done: b')
  })

  it('keeps the current board when none is given', () => {
    expect(titles(applyMove(board(), { id: 'a', to: '', pos: 2 }))[0]).toBe('Backlog: b,a,c')
  })

  it('leaves the board alone for an unknown task or board', () => {
    const before = board()
    expect(applyMove(before, { id: 'nope', to: 'Doing', pos: 1 })).toBe(before)
    expect(applyMove(before, { id: 'a', to: 'Nowhere', pos: 1 })).toBe(before)
  })
})
