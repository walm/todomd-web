import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import type { Project } from '@/api/types'
import { ResponsiveDialog } from '@/components/responsive-dialog'
import { Button } from '@/components/ui/button'
import {
  MIN_TODOMD,
  agentPrompt,
  fileLocation,
  onlineCommands,
  setupCommands,
  startCommands,
  todomdNewEnough,
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

/** A numbered step of the setup. */
function Step({ n, title, children }: { n: number; title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">
        {n}. {title}
      </h3>
      {children}
    </section>
  )
}

/**
 * "Connect an agent": how to have a coding agent work this board. A person
 * only gets todomd (and, for todomd.online, logs in); the prompt has the
 * agent read todomd's skill and loop on `todomd watch`, which also syncs a
 * board linked to todomd.online. It runs on the machine the file is on.
 * Nothing goes through todomd-web, and nothing here is saved.
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
  // Only known for a local file: todomd-web doesn't ask a host about links.
  const linked = !host && Boolean(project.syncedImages)
  const commands = useMemo(() => startCommands(project), [project])
  const online = useMemo(() => onlineCommands(project, linked), [project, linked])
  const prompt = useMemo(() => agentPrompt({ project, boards }), [project, boards])
  const { copied, copy } = useCopy()
  const tooOld = !host && todomdTooOld(todomdVersion)
  const newEnough = !host && todomdNewEnough(todomdVersion)
  const code = (s: string) => <code className="font-mono">{s}</code>

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Connect an agent"
      description="Let a coding agent (Claude Code, Codex, …) answer and pick up cards on this board."
    >
      <div className="flex flex-col gap-5 text-sm">
        <Step
          n={1}
          title={
            <>
              Get todomd {MIN_TODOMD} or newer{host ? <> on {host}</> : null}
            </>
          }
        >
          {tooOld ? (
            <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                This machine has todomd {todomdVersion}, too old for the prompt below.
                Upgrade it first:
              </span>
            </p>
          ) : newEnough ? (
            <p className="flex items-start gap-1.5 text-muted-foreground">
              <Check className="mt-0.5 size-3.5 shrink-0" />
              <span>This machine has todomd {todomdVersion}.</span>
            </p>
          ) : (
            <p className="text-muted-foreground">
              {host ? <>The agent uses the todomd on {host}. </> : null}
              Check with {code('todomd --version')}, and upgrade an older one:
            </p>
          )}
          {setupCommands(host ? undefined : todomdVersion).map((cmd) => (
            <CommandLine key={cmd} command={cmd} />
          ))}
          <p className="text-xs text-muted-foreground">
            {host ? (
              <>
                If the file is linked to todomd.online, also run {code('todomd login')} once on{' '}
                {host} (you approve it in the browser).
              </>
            ) : linked ? (
              <>
                This board is linked to todomd.online. If this machine isn&apos;t logged in yet,
                run {code('todomd login')} once (you approve it in the browser).
              </>
            ) : (
              <>
                That&apos;s all for a local board. To have it on todomd.online too, run{' '}
                {online.map((cmd, i) => (
                  <span key={cmd}>
                    {i > 0 ? ', then ' : null}
                    {code(cmd)}
                  </span>
                ))}{' '}
                in its folder; {code('todomd login')} is once per machine (you approve it in the
                browser).
              </>
            )}
          </p>
        </Step>

        <Step
          n={2}
          title={
            <>
              Start your agent {host ? <>on {host}</> : 'next to the file'} and give it this
              prompt
            </>
          }
        >
          {commands.map((cmd) => (
            <CommandLine key={cmd} command={cmd} />
          ))}
          <div className="flex items-start justify-between gap-3">
            <p className="text-muted-foreground">
              It has the agent read todomd&apos;s skill, then watch the board. The <em>Rules</em>{' '}
              section is yours to change: edit it to match how you like to work. The agent&apos;s
              comments turn up on the board badged, like any other change.
            </p>
            <Button size="sm" variant="outline" onClick={() => void copy(prompt)}>
              {copied ? <Check /> : <Copy />}
              {copied ? 'Copied' : 'Copy prompt'}
            </Button>
          </div>
          <pre className="overflow-auto md:max-h-80 rounded-lg border bg-muted/50 p-3 font-mono text-[0.75rem] leading-relaxed whitespace-pre-wrap">
            {prompt}
          </pre>
        </Step>
      </div>
    </ResponsiveDialog>
  )
}
