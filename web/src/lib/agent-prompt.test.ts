import { describe, expect, it } from 'vitest'
import {
  SKILL_INSTALL,
  agentPrompt,
  fileFlag,
  fileLocation,
  flowBoards,
  onlineCommands,
  shellQuote,
  startCommands,
  todomdNewEnough,
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

describe('fileFlag', () => {
  it('needs no -f for a TODO.md, which todomd finds from its folder', () => {
    expect(fileFlag(local)).toBe('')
    expect(fileFlag(remote)).toBe('')
  })

  it('points at a file with another name', () => {
    expect(fileFlag({ name: 'n', file: '/a b/notes.md' })).toBe(" -f '/a b/notes.md'")
    expect(fileFlag({ name: 'n', file: 'web1:/srv/plan.md', host: 'web1' })).toBe(
      ' -f /srv/plan.md',
    )
  })
})

describe('setup commands', () => {
  it('installs the skill', () => {
    expect(SKILL_INSTALL).toBe('todomd skill --install')
  })

  it('logs in and links a board that is not on todomd.online yet', () => {
    expect(onlineCommands(local, false)).toEqual(['todomd login', 'todomd link'])
    expect(onlineCommands({ name: 'n', file: '/x/plan.md' }, false)).toEqual([
      'todomd login',
      'todomd link -f /x/plan.md',
    ])
  })

  it('only logs in for a board that is linked already', () => {
    expect(onlineCommands(local, true)).toEqual(['todomd login'])
  })
})

describe('agentPrompt', () => {
  const prompt = agentPrompt({ project: local, boards: ['Inbox', 'Doing', 'Done'] })

  it('uses the skill and names the project and its file', () => {
    expect(prompt).toMatch(/^Use the todomd skill to work from my board "todomd-web"/)
    expect(prompt).toContain('(/Users/me/src/todomd-web/TODO.md)')
  })

  it('loops on todomd watch, skipping its own writes', () => {
    expect(prompt).toContain('\n  todomd watch --as agent --ignore-author agent --json\n')
    expect(prompt).toContain('in a loop')
    expect(prompt).toContain('--timeout 100s')
  })

  it('leaves the rest to the skill', () => {
    expect(prompt).not.toMatch(/todomd (sync|changes|comment|move|show)/)
    expect(prompt).not.toMatch(/ssh|login|link/i)
    expect(prompt.split('\n').length).toBeLessThan(30)
  })

  it('keeps the rules in their own section to edit, with the real board names', () => {
    expect(prompt).toContain('## Rules (change these to fit how you work)')
    expect(prompt).toContain('New card in "Inbox"')
    expect(prompt).toContain('move it to "Doing"')
    expect(prompt).toContain('move the card to "Done"')
    expect(prompt).toContain('"GO"')
    expect(prompt).toContain('Never delete cards')
  })

  it('passes -f everywhere for a file todomd would not find', () => {
    const p = agentPrompt({ project: { name: 'n', file: '/a b/plan.md' }, boards: [] })
    expect(p).toContain("Pass `-f '/a b/plan.md'` to every todomd command.")
    expect(p).toContain("--json -f '/a b/plan.md'\n")
  })

  it('uses the path on the host for a project over ssh', () => {
    const p = agentPrompt({ project: remote, boards: ['Backlog', 'In Progress', 'Done'] })
    expect(p).toContain('(/srv/app/TODO.md on this machine (deploy@web1))')
    expect(p).not.toContain('deploy@web1:/srv')
  })

  it("uses todomd's default boards when there are none", () => {
    const p = agentPrompt({ project: local, boards: [] })
    expect(p).toContain('New card in "Backlog"')
    expect(p).toContain('"In Progress"')
  })

  it('quotes board names safely', () => {
    const p = agentPrompt({ project: local, boards: ['Back"log', 'In $Progress', 'Done'] })
    expect(p).toContain('"Back\\"log"')
    expect(p).toContain('"In \\$Progress"')
  })

  it('can write as another name', () => {
    const p = agentPrompt({ project: local, boards: [], agent: 'claude' })
    expect(p).toContain('todomd watch --as claude --ignore-author claude --json')
  })
})

describe('todomd versions', () => {
  it('flags versions without watch and skill', () => {
    expect(todomdTooOld('v0.12.0')).toBe(true)
    expect(todomdTooOld('v0.9.12')).toBe(true)
    expect(todomdNewEnough('v0.12.9')).toBe(false)
  })

  it('accepts v0.13.0 and newer', () => {
    for (const v of ['v0.13.0', '0.13.2', 'v0.14.0', 'v1.0.0']) {
      expect(todomdTooOld(v)).toBe(false)
      expect(todomdNewEnough(v)).toBe(true)
    }
  })

  it('gives an unknown version the benefit of the doubt, without vouching for it', () => {
    for (const v of ['unknown', 'dev', undefined]) {
      expect(todomdTooOld(v)).toBe(false)
      expect(todomdNewEnough(v)).toBe(false)
    }
  })
})
