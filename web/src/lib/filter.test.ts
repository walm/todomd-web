import { describe, expect, it } from 'vitest'
import { filterBoards, queryPriorities } from './filter'
import type { Board, Priority, Task } from '@/api/types'

const task = (id: string, title: string, priority: Priority = 'normal'): Task => ({
  id,
  board: 'Backlog',
  title,
  tags: [],
  priority,
  due: null,
  description: '',
  comments: [],
})

const boards = (): Board[] => [
  {
    name: 'Backlog',
    tasks: [
      task('a1', 'Fix the parser', 'high'),
      task('b2', 'High contrast mode'),
      task('c3', 'Tidy the docs', 'low'),
    ],
  },
]

const titles = (result: Board[]) => result[0].tasks.map((t) => t.title)

describe('filtering', () => {
  it('matches text across the fields a card shows', () => {
    expect(titles(filterBoards(boards(), 'parser'))).toEqual(['Fix the parser'])
    expect(titles(filterBoards(boards(), 'a1'))).toEqual(['Fix the parser'])
  })

  it('treats a bare word as text, even when it names a priority', () => {
    // "high" must still find a task called "High contrast mode".
    expect(titles(filterBoards(boards(), 'high'))).toEqual(['High contrast mode'])
  })

  it('filters by priority when the term says so', () => {
    expect(titles(filterBoards(boards(), 'priority:high'))).toEqual(['Fix the parser'])
    expect(titles(filterBoards(boards(), '!high'))).toEqual(['Fix the parser'])
    expect(titles(filterBoards(boards(), '!low'))).toEqual(['Tidy the docs'])
    expect(titles(filterBoards(boards(), '!normal'))).toEqual(['High contrast mode'])
  })

  it('combines a priority term with text', () => {
    expect(titles(filterBoards(boards(), '!high parser'))).toEqual(['Fix the parser'])
    expect(titles(filterBoards(boards(), '!high docs'))).toEqual([])
  })

  it('reports which priorities a query names', () => {
    expect(queryPriorities('!high')).toEqual(['high'])
    expect(queryPriorities('priority:low docs')).toEqual(['low'])
    expect(queryPriorities('high')).toEqual([])
  })

  it('passes everything through for an empty query', () => {
    expect(titles(filterBoards(boards(), '   '))).toHaveLength(3)
  })
})

describe('filtering on links', () => {
  const linked = (): Board[] => [
    {
      name: 'Backlog',
      tasks: [
        {
          ...task('aaaa', 'Blocked by open'),
          links: [{ kind: 'blocked by', id: 'bbbb', title: 'Open', board: 'Backlog', stored_on: 'bbbb' }],
        },
        {
          ...task('bbbb', 'Open'),
          links: [{ kind: 'blocks', id: 'aaaa', title: 'Blocked by open', board: 'Backlog', stored_on: 'bbbb' }],
        },
        {
          ...task('cccc', 'Blocked by done'),
          links: [{ kind: 'blocked by', id: 'dddd', title: 'Finished', board: 'Done', stored_on: 'cccc' }],
        },
        {
          ...task('eeee', 'Blocked by a card off the board'),
          links: [{ kind: 'blocked by', id: 'zzzz', title: null, board: null, stored_on: 'eeee' }],
        },
      ],
    },
    { name: 'Done', tasks: [{ ...task('dddd', 'Finished'), links: [] }] },
  ]

  it('is:blocked keeps cards blocked by an open card', () => {
    expect(titles(filterBoards(linked(), 'is:blocked'))).toEqual(['Blocked by open'])
  })

  it('link:id keeps the cards linked to it, either way', () => {
    expect(titles(filterBoards(linked(), 'link:bbbb'))).toEqual(['Blocked by open'])
    expect(titles(filterBoards(linked(), 'link:#aaaa'))).toEqual(['Open'])
    expect(titles(filterBoards(linked(), 'link:dd'))).toEqual(['Blocked by done'])
  })

  it('a board from an old todomd, without links, filters to nothing', () => {
    expect(titles(filterBoards(boards(), 'is:blocked'))).toEqual([])
    expect(titles(filterBoards(boards(), 'link:a1'))).toEqual([])
  })
})
