import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TagField, addTags } from './tag-field'
import type { TagCount } from '@/lib/tag-suggest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const suggestions: TagCount[] = [
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

function mount(initial: string[] = [], onSubmit = vi.fn()) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  let tags: string[] = initial
  let text = ''
  function Harness() {
    const [t, setT] = useState(initial)
    const [x, setX] = useState('')
    tags = t
    text = x
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
        onKeyDown={(e) => e.key === 'Enter' && !e.defaultPrevented && onSubmit()}
      >
        <TagField tags={t} onTagsChange={setT} text={x} onTextChange={setX} suggestions={suggestions} />
      </form>
    )
  }
  act(() => root!.render(<Harness />))
  const input = host.querySelector('input')!
  return { input, onSubmit, tags: () => tags, text: () => text }
}

function type(input: HTMLInputElement, value: string) {
  act(() => {
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function key(input: HTMLInputElement, k: string) {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  act(() => void input.dispatchEvent(ev))
  return ev
}
function paste(input: HTMLInputElement, data: string) {
  const ev = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: () => string }
  }
  ev.clipboardData = { getData: () => data }
  act(() => void input.dispatchEvent(ev))
  return ev
}
const pills = () =>
  [...document.querySelectorAll('[aria-label="Current tags"] li')].map((l) =>
    l.textContent?.trim(),
  )
const options = () => [...document.querySelectorAll('[role=option]')].map((o) => o.textContent)

describe('addTags', () => {
  it('normalises and skips duplicates', () => {
    expect(addTags(['a'], ['#A, b', 'b c', ''])).toEqual(['a', 'b', 'c'])
  })
})

describe('TagField', () => {
  it('shows existing tags as pills with a labelled remove button', () => {
    mount(['billing', 'ui'])
    expect(pills()).toEqual(['billing', 'ui'])
    expect(document.querySelector('button[aria-label="Remove tag billing"]')).not.toBeNull()
    expect(document.querySelector('[role=group]')!.getAttribute('aria-label')).toBe('Tags')
  })

  it('turns text into a pill on comma, space or Enter', () => {
    const m = mount()
    type(m.input, 'api,')
    expect(m.tags()).toEqual(['api'])
    expect(m.text()).toBe('')
    type(m.input, 'docs ')
    expect(m.tags()).toEqual(['api', 'docs'])
    type(m.input, 'zzz')
    const ev = key(m.input, 'Enter')
    // "zzz" has only the Create row, so Enter picks that.
    expect(ev.defaultPrevented).toBe(true)
    expect(m.tags()).toEqual(['api', 'docs', 'zzz'])
    expect(m.onSubmit).not.toHaveBeenCalled()
  })

  it('does not add a duplicate pill', () => {
    const m = mount(['ui'])
    type(m.input, 'ui,')
    expect(m.tags()).toEqual(['ui'])
  })

  it('removes a pill with its ×', () => {
    const m = mount(['billing', 'ui'])
    act(() => (document.querySelector('button[aria-label="Remove tag billing"]') as HTMLElement).click())
    expect(m.tags()).toEqual(['ui'])
    expect(document.activeElement).toBe(m.input)
  })

  it('Backspace in the empty input selects, then removes, the last pill', () => {
    const m = mount(['billing', 'ui'])
    key(m.input, 'Backspace')
    expect(m.tags()).toEqual(['billing', 'ui'])
    expect(document.querySelectorAll('li > span.ring-2').length).toBe(1)
    key(m.input, 'Backspace')
    expect(m.tags()).toEqual(['billing'])
  })

  it('Backspace with text left only edits the text', () => {
    const m = mount(['billing'])
    type(m.input, 'a')
    const ev = key(m.input, 'Backspace')
    expect(ev.defaultPrevented).toBe(false)
    expect(m.tags()).toEqual(['billing'])
  })

  it('walks the pills with the arrow keys and deletes the selected one', () => {
    const m = mount(['a', 'b', 'c'])
    key(m.input, 'ArrowLeft')
    key(m.input, 'ArrowLeft')
    key(m.input, 'Delete')
    expect(m.tags()).toEqual(['a', 'c'])
  })

  it('turns a pasted list into pills', () => {
    const m = mount()
    const ev = paste(m.input, 'a, b c')
    expect(ev.defaultPrevented).toBe(true)
    expect(m.tags()).toEqual(['a', 'b', 'c'])
  })

  it('suggests, leaves out tags already there, and picks with Enter, Tab or a tap', () => {
    const m = mount(['billing'])
    type(m.input, 'bil')
    expect(options()).toEqual(['rebilling · 1', 'Create “bil”'])
    key(m.input, 'Enter')
    expect(m.tags()).toEqual(['billing', 'rebilling'])
    type(m.input, 'u')
    key(m.input, 'Tab')
    expect(m.tags()).toEqual(['billing', 'rebilling', 'ui'])
    type(m.input, 'zz')
    act(() => (document.querySelector('[role=option]') as HTMLElement).click())
    expect(m.tags()).toEqual(['billing', 'rebilling', 'ui', 'zz'])
  })

  it('Esc closes the list only', () => {
    const m = mount()
    type(m.input, 'bil')
    expect(key(m.input, 'Escape').defaultPrevented).toBe(true)
    expect(options()).toEqual([])
  })

  it('leaves Enter to the form when the input is empty', () => {
    const m = mount(['a'])
    key(m.input, 'Enter')
    expect(m.onSubmit).toHaveBeenCalled()
  })
})
