import { describe, expect, it } from 'vitest'
import { attachmentUrl, formatBytes, insertSnippet, newDraftId } from './attach'

describe('insertSnippet', () => {
  const link = '![a.png](/s/a.png)'

  it('puts the link on a line of its own', () => {
    expect(insertSnippet('before after', 6, 6, link)).toEqual({
      text: `before\n${link}\n after`,
      caret: 7 + link.length,
    })
  })

  it('adds no blank lines it does not need', () => {
    expect(insertSnippet('', 0, 0, link)).toEqual({ text: link, caret: link.length })
    expect(insertSnippet('one\n', 4, 4, link).text).toBe(`one\n${link}`)
    // An empty line is taken by the link rather than pushed down.
    expect(insertSnippet('one\n\ntwo', 4, 4, link).text).toBe(`one\n${link}\ntwo`)
  })

  it('replaces a selection', () => {
    expect(insertSnippet('keep DROP keep', 5, 9, link).text).toBe(`keep \n${link}\n keep`)
  })

  it('clamps a caret that has fallen off the end of edited text', () => {
    expect(insertSnippet('ab', 10, 12, link).text).toBe(`ab\n${link}`)
  })
})

describe('attachmentUrl', () => {
  const root = '/Users/jane smith/.local/state/todomd-web/attachments/9c1fa3b2d4e5f607'

  it('serves a link under the project root through the API', () => {
    expect(attachmentUrl(`${root}/3f2a/shot.png`, 'my app', root)).toBe(
      '/api/projects/my%20app/attachments/3f2a/shot.png',
    )
  })

  it('reads the percent-encoded form markdown hands over', () => {
    expect(attachmentUrl(encodeURI(`${root}/3f2a/skärm bild.png`), 'app', root)).toBe(
      '/api/projects/app/attachments/3f2a/sk%C3%A4rm%20bild.png',
    )
  })

  it('leaves anything else alone', () => {
    expect(attachmentUrl('https://example.com/a.png', 'app', root)).toBeNull()
    expect(attachmentUrl('javascript:alert(1)', 'app', root)).toBeNull()
    expect(attachmentUrl(`${root}/3f2a`, 'app', root)).toBeNull()
    // A sibling directory that merely shares the prefix is not ours.
    expect(attachmentUrl(`${root}-other/3f2a/a.png`, 'app', root)).toBeNull()
    expect(attachmentUrl(`${root}/3f2a/a.png`, 'app', undefined)).toBeNull()
  })
})

describe('attachmentUrl for images synced with todomd.online', () => {
  const synced = '/Users/jane smith/.local/state/todomd/attachments/prj_8x2k'
  const att = 'att_5f1c0a9be3d2a7c4b6e8'

  it('serves an image in the synced folder through the API', () => {
    expect(attachmentUrl(encodeURI(`${synced}/${att}/screenshot.png`), 'app', undefined, synced)).toBe(
      `/api/projects/app/synced/${att}/screenshot.png`,
    )
  })

  it('still serves attachments when both folders are known', () => {
    const root = '/Users/jane/.local/state/todomd-web/attachments/9c1fa3b2d4e5f607'
    expect(attachmentUrl(`${root}/3f2a/a.png`, 'app', root, synced)).toBe('/api/projects/app/attachments/3f2a/a.png')
  })

  it('leaves anything else in or near the folder alone', () => {
    expect(attachmentUrl(`${synced}/not-an-id/a.png`, 'app', undefined, synced)).toBeNull()
    expect(attachmentUrl(`${synced}/${att}/deeper/a.png`, 'app', undefined, synced)).toBeNull()
    expect(attachmentUrl(`${synced}-other/${att}/a.png`, 'app', undefined, synced)).toBeNull()
    expect(attachmentUrl(`${synced}/${att}/a.png`, 'app', undefined, undefined)).toBeNull()
  })
})

describe('newDraftId', () => {
  it('is what the server accepts, and never the same twice', () => {
    const a = newDraftId()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(newDraftId()).not.toBe(a)
  })
})

describe('formatBytes', () => {
  it('reads like a person would say it', () => {
    expect(formatBytes(25 << 20)).toBe('25 MB')
    expect(formatBytes(1536)).toBe('2 KB')
    expect(formatBytes(12)).toBe('12 bytes')
  })
})
