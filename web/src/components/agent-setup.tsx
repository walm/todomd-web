import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import type { Project } from '@/api/types'
import { ResponsiveDialog } from '@/components/responsive-dialog'
import { Button } from '@/components/ui/button'
import {
  MIN_TODOMD,
  agentPrompt,
  fileLocation,
  startCommands,
  todomdTooOld,
} from '@/lib/agent-prompt'

/** Copies text, and says so for a moment. */
function useCopy() {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      toast.error('Could not copy to the clipboard', {
        description: 'Select the text and copy it yourself.',
      })
    }
  }

  return { copied, copy }
}

/** One shell command, with a copy button at its end. */
function CommandLine({ command }: { command: string }) {
  const { copied, copy } = useCopy()
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/50 py-1 pr-1 pl-3 font-mono text-xs">
      <span className="text-muted-foreground select-none" aria-hidden>
        $
      </span>
      <code className="min-w-0 grow overflow-x-auto whitespace-nowrap">{command}</code>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={copied ? 'Copied' : `Copy ${command}`}
        title={copied ? 'Copied' : 'Copy'}
        onClick={() => void copy(command)}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  )
}

/**
 * "Connect an agent": how to have a coding agent work this board. It watches
 * the project's TODO.md with the todomd CLI, on the machine the file is on —
 * nothing goes through todomd-web, and nothing here is saved.
 */
export function AgentSetup({
  open,
  onOpenChange,
  project,
  boards,
  todomdVersion,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
  boards: string[]
  /** This machine's todomd, which is the one a local project's agent uses. */
  todomdVersion?: string
}) {
  const { host } = fileLocation(project)
  const commands = useMemo(() => startCommands(project), [project])
  const prompt = useMemo(() => agentPrompt({ project, boards }), [project, boards])
  const { copied, copy } = useCopy()
  const tooOld = !host && todomdTooOld(todomdVersion)

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Connect an agent"
      description="Let a coding agent (Claude Code, Codex, …) answer and pick up cards on this board."
    >
      <div className="flex flex-col gap-5 text-sm">
        <section className="flex flex-col gap-2">
          <h3 className="font-medium">
            1. Open a terminal {host ? <>on {host}</> : 'next to the file'}
          </h3>
          <p className="text-muted-foreground">
            {host ? (
              <>
                This project&apos;s file is on <span className="font-mono">{host}</span>, so the
                agent runs there, where todomd keeps the file&apos;s lock and change cursor.
              </>
            ) : (
              <>
                The agent works on this project&apos;s todo file directly, on this computer: no
                login and no sync. Start it in the project&apos;s folder.
              </>
            )}
          </p>
          {commands.map((cmd) => (
            <CommandLine key={cmd} command={cmd} />
          ))}
          {tooOld ? (
            <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                This machine has todomd {todomdVersion}; the prompt needs {MIN_TODOMD} or newer.
                Run <code className="font-mono">todomd upgrade</code> first.
              </span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Needs todomd {MIN_TODOMD} or newer{host ? ' on that host' : ''}.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium">2. Give your agent this prompt</h3>
            <Button size="sm" variant="outline" onClick={() => void copy(prompt)}>
              {copied ? <Check /> : <Copy />}
              {copied ? 'Copied' : 'Copy prompt'}
            </Button>
          </div>
          <p className="text-muted-foreground">
            Start the agent there and paste it. The <em>Rules</em> section is yours to change:
            copy the prompt, then edit it to match how you like to work. The agent&apos;s
            comments turn up on the board badged, like any other change.
          </p>
          <pre className="overflow-auto md:max-h-80 rounded-lg border bg-muted/50 p-3 font-mono text-[0.75rem] leading-relaxed whitespace-pre-wrap">
            {prompt}
          </pre>
        </section>
      </div>
    </ResponsiveDialog>
  )
}
