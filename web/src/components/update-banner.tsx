import { useState } from 'react'
import { ArrowUpCircle, ExternalLink, Loader2, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'

/** Dismissals are per version: skipping v0.3.0 should not hide v0.4.0. */
const DISMISSED = 'todomd-web:update-dismissed'

/** How long to keep trying to reach the restarted server before giving up. */
const RESTART_TIMEOUT = 30_000

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Waits for the server to answer again after it execs into the new binary. */
async function waitForServer(): Promise<boolean> {
  const deadline = Date.now() + RESTART_TIMEOUT
  while (Date.now() < deadline) {
    await wait(500)
    try {
      const res = await fetch('/api/config', { cache: 'no-store' })
      if (res.ok) return true
    } catch {
      // still down; keep waiting
    }
  }
  return false
}

/**
 * A quiet bar above the board when a newer release exists — the board is the
 * kind of thing that stays open for weeks, so it is the only place an upgrade
 * is likely to be noticed.
 *
 * Upgrading replaces the binary and restarts the server into it, so this
 * waits for it to come back and reloads the page rather than leaving you
 * looking at a tab talking to a process that no longer exists.
 */
export function UpdateBanner() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED))
  const [state, setState] = useState<'idle' | 'upgrading' | 'restarting'>('idle')

  const update = useQuery({
    queryKey: ['update'],
    queryFn: api.update,
    // The server answers from a cache it refreshes at most every few hours,
    // so asking on focus costs nothing and catches a release published while
    // the tab sat open.
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: true,
  })

  const data = update.data
  if (!data?.supported || !data.available || !data.latest) return null
  if (dismissed === data.latest && state === 'idle') return null

  const upgrade = async () => {
    setState('upgrading')
    try {
      const result = await api.upgrade()
      if (!result.upgraded) {
        toast.info(`Already running ${result.version}`)
        setState('idle')
        return
      }
      if (!result.restarting) {
        toast.success(`Installed ${result.version}`, {
          description: 'Restart todomd-web to run it.',
        })
        setState('idle')
        return
      }
      setState('restarting')
      if (await waitForServer()) {
        window.location.reload()
        return
      }
      toast.error('The server did not come back', {
        description: `${result.version} is installed — start todomd-web again.`,
      })
      setState('idle')
    } catch (err) {
      // The binary on disk is untouched unless the whole thing succeeded, so
      // there is nothing to undo here.
      toast.error('Could not upgrade', { description: (err as Error).message })
      setState('idle')
    }
  }

  const busy = state !== 'idle'

  return (
    <div className="flex items-center gap-2 border-b bg-emerald-500/10 px-3 py-1.5 text-sm">
      <ArrowUpCircle className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <p className="min-w-0 grow truncate">
        <span className="font-medium">todomd-web {data.latest}</span>{' '}
        <span className="text-muted-foreground">is available — you have {data.current}</span>
      </p>

      <Button
        variant="ghost"
        size="sm"
        render={
          <a href={data.releaseUrl} target="_blank" rel="noreferrer noopener">
            <span className="hidden sm:inline">Changelog</span>
            <ExternalLink />
          </a>
        }
      />
      <Button size="sm" onClick={upgrade} disabled={busy}>
        {busy && <Loader2 className="animate-spin" />}
        {state === 'restarting' ? 'Restarting…' : state === 'upgrading' ? 'Upgrading…' : 'Upgrade'}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss until the next release"
        disabled={busy}
        onClick={() => {
          localStorage.setItem(DISMISSED, data.latest!)
          setDismissed(data.latest!)
        }}
      >
        <X />
      </Button>
    </div>
  )
}
