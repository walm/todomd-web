import { describe, expect, it } from 'vitest'
import {
  agentPrompt,
  fileLocation,
  flowBoards,
  shellQuote,
  startCommands,
  todomdTooOld,
} from './agent-prompt'

const local = { name: 'todomd-web', file: '/Users/me/src/todomd-web/TODO.md' }
const remote = { name: 'web1:app', file: 'deploy@web1:/srv/app/TODO.md', host: 'deploy@web1' }

describe('flowBoards', () => {
  it('finds the usual boards by name', () => {
    expect(flowBoards(['Backlog', 'In Progress', 'Review', 'Done'])).toEqual({
      inbox: 'Backlog',
      working: 'In Progress',
      done: 'Done',
    })
  })

  it('falls back to position for other names', () => {
    expect(flowBoards(['Ideas', 'Now', 'Later'])).toEqual({
      inbox: 'Ideas',
      working: 'Now',
      done: 'Later',
    })
  })

  it("has todomd's defaults when there are no boards", () => {
    expect(flowBoards([])).toEqual({ inbox: 'Backlog', working: 'In Progress', done: 'Done' })
  })
})

describe('fileLocation', () => {
  it('splits a local path', () => {
    expect(fileLocation(local)).toEqual({
      host: undefined,
      path: '/Users/me/src/todomd-web/TODO.md',
      dir: '/Users/me/src/todomd-web',
    })
  })

  it('takes the host off an ssh path', () => {
    expect(fileLocation(remote)).toEqual({
      host: 'deploy@web1',
      path: '/srv/app/TODO.md',
      dir: '/srv/app',
    })
    expect(fileLocation({ name: 'x', file: 'web1:~/notes/TODO.md', host: 'web1' }).dir).toBe(
      '~/notes',
    )
  })
})

describe('shellQuote', () => {
  it('leaves plain paths alone', () => {
    expect(shellQuote('/srv/app/TODO.md')).toBe('/srv/app/TODO.md')
    expect(shellQuote('deploy@web1')).toBe('deploy@web1')
  })

  it('quotes what the shell would split or expand', () => {
    expect(shellQuote('/Users/me/My Notes/TODO.md')).toBe("'/Users/me/My Notes/TODO.md'")
    expect(shellQuote("/tmp/it's/TODO.md")).toBe(`'/tmp/it'\\''s/TODO.md'`)
    expect(shellQuote('/tmp/$HOME/TODO.md')).toBe("'/tmp/$HOME/TODO.md'")
  })

  it('keeps a leading ~ expandable', () => {
    expect(shellQuote('~/My Notes/TODO.md')).toBe("~/'My Notes/TODO.md'")
  })
})

describe('startCommands', () => {
  it('starts next to a local file', () => {
    expect(startCommands(local)).toEqual(['cd /Users/me/src/todomd-web'])
  })

  it('goes to the host first for a project over ssh', () => {
    expect(startCommands(remote)).toEqual(['ssh deploy@web1', 'cd /srv/app'])
  })
})

describe('agentPrompt', () => {
  const prompt = agentPrompt({ project: local, boards: ['Inbox', 'Doing', 'Done'] })

  it('names the project, its file and its boards', () => {
    expect(prompt).toContain('the todomd board "todomd-web"')
    expect(prompt).toContain('live in\n/Users/me/src/todomd-web/TODO.md, which I have open')
    expect(prompt).toContain('New card in "Inbox"')
    expect(prompt).toContain('move it to "Doing"')
    expect(prompt).toContain('move the card to "Done"')
  })

  it('points every command at the file', () => {
    const f = '-f /Users/me/src/todomd-web/TODO.md'
    expect(prompt).toContain(
      `todomd changes --wait --as agent --ignore-author agent --json ${f}`,
    )
    expect(prompt).toContain(`todomd show <id> ${f}`)
    expect(prompt).toContain(`todomd comment <id> "<text>" --author agent --as agent ${f}`)
    expect(prompt).toContain(`todomd move <id> --to "<board>" --as agent ${f}`)
  })

  it('keeps the rules in their own section to edit', () => {
    expect(prompt).toContain('## Rules (change these to fit how you work)')
    expect(prompt).toContain('"GO"')
    expect(prompt).toContain('Never delete cards')
  })

  it('says nothing about ssh, login or sync for a local file', () => {
    expect(prompt).not.toMatch(/ssh|login|sync|link/i)
  })

  it('uses the path on the host for a project over ssh', () => {
    const p = agentPrompt({ project: remote, boards: ['Backlog', 'In Progress', 'Done'] })
    expect(p).toContain('/srv/app/TODO.md on this machine (deploy@web1)')
    expect(p).toContain('--json -f /srv/app/TODO.md')
    expect(p).not.toContain('deploy@web1:/srv')
  })

  it('quotes a path with spaces', () => {
    const p = agentPrompt({ project: { name: 'n', file: '/a b/TODO.md' }, boards: [] })
    expect(p).toContain("--json -f '/a b/TODO.md'")
  })

  it('quotes board names safely for the shell', () => {
    const p = agentPrompt({ project: local, boards: ['Back"log', 'In $Progress', 'Done'] })
    expect(p).toContain('"Back\\"log"')
    expect(p).toContain('"In \\$Progress"')
  })

  it('can write as another name', () => {
    const p = agentPrompt({ project: local, boards: [], agent: 'claude' })
    expect(p).toContain('--as claude --ignore-author claude')
    expect(p).toContain('--author claude --as claude')
  })
})

describe('todomdTooOld', () => {
  it('flags versions without changes --wait', () => {
    expect(todomdTooOld('v0.9.0')).toBe(true)
    expect(todomdTooOld('v0.9.12')).toBe(true)
  })

  it('accepts v0.10.0 and newer', () => {
    expect(todomdTooOld('v0.10.0')).toBe(false)
    expect(todomdTooOld('0.11.2')).toBe(false)
    expect(todomdTooOld('v1.0.0')).toBe(false)
  })

  it('gives an unknown version the benefit of the doubt', () => {
    expect(todomdTooOld('unknown')).toBe(false)
    expect(todomdTooOld('dev')).toBe(false)
    expect(todomdTooOld(undefined)).toBe(false)
  })
})
