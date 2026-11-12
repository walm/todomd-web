import { describe, expect, it } from 'vitest'
import type { Board, Task } from '@/api/types'
import { STICKERS, parseStickerTerm, stickerOf, stickersSupported } from './stickers'

const task = (extra: Partial<Task> = {}): Task => ({
  id: 'aaaa',
  board: 'Backlog',
  title: 'A card',
  tags: [],
  priority: 'normal',
  due: null,
  description: '',
  comments: [],
  ...extra,
})

describe('stickers', () => {
  it('has the CLI set, in its order', () => {
    // `todomd sticker --json`
    expect(STICKERS.map((s) => s.name)).toEqual([
      'fire', 'star', 'eyes', 'wip', 'check', 'target', 'zap', 'idea', 'bug', 'ship', 'question', 'heart',
      'red', 'amber', 'green', 'blue', 'violet',
    ])
    expect(STICKERS.filter((s) => s.kind === 'emoji').every((s) => s.emoji)).toBe(true)
  })

  it('reads a filter value as todomd list --sticker does', () => {
    expect(parseStickerTerm('fire')).toBe('fire')
    expect(parseStickerTerm('🚀')).toBe('ship')
    expect(parseStickerTerm('❤')).toBe('heart')
    expect(parseStickerTerm('VIOLET')).toBe('violet')
    expect(parseStickerTerm('any')).toBe('any')
    expect(parseStickerTerm('none')).toBe('none')
    expect(parseStickerTerm('unicorn')).toBeUndefined()
    expect(parseStickerTerm('')).toBeUndefined()
  })

  it('looks a card’s sticker up', () => {
    expect(stickerOf(task({ sticker: 'zap' }))?.emoji).toBe('⚡')
    expect(stickerOf(task({ sticker: 'blue' }))?.kind).toBe('ribbon')
    expect(stickerOf(task({ sticker: null }))).toBeUndefined()
    expect(stickerOf(task())).toBeUndefined()
  })

  it('tells an old todomd, which sends no sticker key, from cards without one', () => {
    const board = (tasks: Task[]): Board[] => [{ name: 'Backlog', tasks }]
    expect(stickersSupported(board([task({ sticker: null }), task({ sticker: 'red' })]))).toBe(true)
    expect(stickersSupported(board([task()]))).toBe(false)
    expect(stickersSupported(board([]))).toBe(true)
  })
})
