import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TagInput } from './tag-input'
import type { TagCount } from '@/lib/tag-suggest'
import type { TagMode } from '@/lib/tag-suggest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const tags: TagCount[] = [
  { tag: 'billing', count: 7 },
  { tag: 'ui', count: 4 },
  { tag: 'rebilling', count: 1 },
]

let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

function mount(initial: string, mode: TagMode = 'tags', onSubmit = vi.fn()) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const values: string[] = []
  function Harness() {
    const [v, setV] = useState(initial)
    values.push(v)
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
        onKeyDown={(e) => e.key === 'Enter' && !e.defaultPrevented && onSubmit()}
      >
        <TagInput value={v} onValueChange={setV} tags={tags} mode={mode} aria-label="t" />
      </form>
    )
  }
  act(() => root!.render(<Harness />))
  const input = host.querySelector('input')!
  return { input, onSubmit, value: () => values.at(-1)! }
}

function type(input: HTMLInputElement, text: string) {
  act(() => {
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.setSelectionRange(text.length, text.length)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function key(input: HTMLInputElement, k: string) {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  act(() => void input.dispatchEvent(ev))
  return ev
}
const options = () => [...document.querySelectorAll('[role=option]')].map((o) => o.textContent)

describe('TagInput', () => {
  it('lists matches with counts and a Create row', () => {
    const { input } = mount('')
    type(input, 'bil')
    expect(options()).toEqual(['billing · 7', 'rebilling · 1', 'Create “bil”'])
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(input.getAttribute('aria-activedescendant')).toBe(
      document.querySelector('[role=option]')!.id,
    )
  })

  it('moves with the arrows and picks with Enter without submitting', () => {
    const { input, onSubmit, value } = mount('')
    type(input, 'bil')
    key(input, 'ArrowDown')
    expect(document.querySelectorAll('[aria-selected=true]')[0].textContent).toBe('rebilling · 1')
    key(input, 'ArrowUp')
    const ev = key(input, 'Enter')
    expect(ev.defaultPrevented).toBe(true)
    expect(value()).toBe('billing ')
    expect(options()).toEqual([])
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('picks with Tab, and Create inserts the new tag', () => {
    const a = mount('')
    type(a.input, 'ui')
    key(a.input, 'Tab')
    expect(a.value()).toBe('ui ')
    act(() => root!.unmount())
    host!.remove()
    const b = mount('')
    type(b.input, 'zzz')
    expect(options()).toEqual(['Create “zzz”'])
    key(b.input, 'Enter')
    expect(b.value()).toBe('zzz ')
  })

  it('closes on Escape and stops it reaching the dialog', () => {
    const { input } = mount('')
    type(input, 'bil')
    const ev = key(input, 'Escape')
    expect(ev.defaultPrevented).toBe(true)
    expect(options()).toEqual([])
  })

  it('leaves out tags already on the card', () => {
    const { input } = mount('')
    type(input, 'billing, bil')
    expect(options()).toEqual(['rebilling · 1', 'Create “bil”'])
  })

  it('submits on Enter when nothing is suggested', () => {
    const { input, onSubmit } = mount('')
    type(input, '')
    key(input, 'Enter')
    expect(onSubmit).toHaveBeenCalled()
  })

  it('picks by tap', () => {
    const { input, value } = mount('')
    type(input, 'u')
    act(() => (document.querySelector('[role=option]') as HTMLElement).click())
    expect(value()).toBe('ui ')
  })

  it('suggests in the filter box only after # or tag:', () => {
    const { input, value } = mount('', 'filter')
    type(input, 'bil')
    expect(options()).toEqual([])
    type(input, 'login #bil')
    expect(options()).toEqual(['billing · 7', 'rebilling · 1'])
    key(input, 'Enter')
    expect(value()).toBe('login #billing ')
    type(input, 'tag:u')
    expect(options()).toEqual(['ui · 4'])
  })
})
