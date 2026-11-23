import { describe, expect, it } from 'vitest'
import type { Board, Task } from '@/api/types'
import { applyTag, countTags, suggest, wordAt } from './tag-suggest'

const task = (id: string, tags: string[]): Task => ({
  id,
  board: 'Backlog',
  title: id,
  tags,
  priority: 'normal',
  due: null,
  description: '',
  comments: [],
})
const boards: Board[] = [
  { name: 'Backlog', tasks: [task('a', ['billing', 'ui']), task('b', ['Billing'])] },
  { name: 'Done', tasks: [task('c', ['billing', 'api', 'ui']), task('d', ['rebilling', 'bill'])] },
]
const tags = countTags(boards)

describe('countTags', () => {
  it('counts cards per tag, case-insensitively, most used first', () => {
    expect(tags.slice(0, 2)).toEqual([
      { tag: 'billing', count: 3 },
      { tag: 'ui', count: 2 },
    ])
    expect(tags.map((t) => t.tag)).toEqual(['billing', 'ui', 'api', 'bill', 'rebilling'])
  })
  it('counts a tag once per card', () => {
    expect(countTags([{ name: 'x', tasks: [task('a', ['x', 'X'])] }])).toEqual([
      { tag: 'x', count: 1 },
    ])
  })
})

describe('suggest', () => {
  it('lists prefix matches before contains, most used first', () => {
    expect(suggest(tags, 'bill').map((s) => s.tag)).toEqual(['billing', 'bill', 'rebilling'])
  })
  it('ignores case and a leading #', () => {
    expect(suggest(tags, '#BILL')[0]).toEqual({ tag: 'billing', count: 3 })
  })
  it('leaves out excluded tags', () => {
    expect(suggest(tags, 'bill', { exclude: ['Billing'] }).map((s) => s.tag)).toEqual([
      'bill',
      'rebilling',
    ])
  })
  it('offers Create unless something matches exactly', () => {
    expect(suggest(tags, 'bil', { create: true }).at(-1)).toEqual({ tag: 'bil', create: true })
    expect(suggest(tags, 'BILL', { create: true }).some((s) => s.create)).toBe(false)
    expect(suggest(tags, 'bill', { create: true, exclude: ['bill'] }).some((s) => s.create)).toBe(false)
  })
  it('has no Create row for an empty word or in filter use', () => {
    expect(suggest(tags, '', { create: true }).some((s) => s.create)).toBe(false)
    expect(suggest(tags, 'zzz')).toEqual([])
  })
})

describe('wordAt', () => {
  it('finds the word at the caret in a tags field', () => {
    expect(wordAt('ui, bil', 7, 'tags')).toEqual({ word: 'bil', start: 4, end: 7 })
    expect(wordAt('ui, #bil api', 8, 'tags')).toEqual({ word: 'bil', start: 5, end: 8 })
    expect(wordAt('ui, ', 4, 'tags')).toEqual({ word: '', start: 4, end: 4 })
  })
  it('needs # or tag: in the filter box', () => {
    expect(wordAt('login !high #bi', 15, 'filter')).toEqual({ word: 'bi', start: 13, end: 15 })
    expect(wordAt('tag:bi', 6, 'filter')).toEqual({ word: 'bi', start: 4, end: 6 })
    expect(wordAt('#', 1, 'filter')).toEqual({ word: '', start: 1, end: 1 })
    expect(wordAt('login', 5, 'filter')).toBeNull()
    expect(wordAt('is:blocked', 10, 'filter')).toBeNull()
  })
})

describe('applyTag', () => {
  it('swaps the word and moves the caret past it', () => {
    const w = wordAt('ui, bil', 7, 'tags')!
    expect(applyTag('ui, bil', w, 'billing')).toEqual({ value: 'ui, billing ', caret: 12 })
  })
  it('keeps the filter prefix and what follows', () => {
    const w = wordAt('#bi !high', 3, 'filter')!
    expect(applyTag('#bi !high', w, 'billing')).toEqual({ value: '#billing !high', caret: 9 })
  })
})
