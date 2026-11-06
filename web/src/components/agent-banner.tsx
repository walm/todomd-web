import { useState } from 'react'
import { Bot, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

const KEY = 'todomd-web:agent-banner'

/** Whether "Don't show again" was chosen in this browser. Storage can be
 *  unavailable (a private window, blocked site data); then the banner shows. */
function dismissedForGood(): boolean {
  try {
    return localStorage.getItem(KEY) === 'hidden'
  } catch {
    return false
  }
}

/**
 * A one-line hint above the board pointing at "Connect an agent". The ×
 * hides it until the next visit; "Don't show again" hides it in this browser
 * for every project.
 */
export function AgentBanner({ onSetUp }: { onSetUp: () => void }) {
  const [hidden, setHidden] = useState(dismissedForGood)
  if (hidden) return null

  const never = () => {
    try {
      localStorage.setItem(KEY, 'hidden')
    } catch {
      // Not remembered, but still gone for this visit.
    }
    setHidden(true)
  }

  return (
    <div
      role="region"
      aria-label="Connect an agent"
      className="flex items-center gap-2 border-b bg-violet-500/10 px-3 py-1.5 text-sm"
    >
      <Bot className="hidden size-4 shrink-0 text-violet-600 sm:block dark:text-violet-400" />
      {/* A phone has no room for the sentence, so the button says it. */}
      <p className="hidden min-w-0 grow truncate sm:block">
        Let a coding agent answer and pick up cards on this board.
      </p>
      <Button size="sm" className="max-sm:mr-auto" onClick={onSetUp}>
        <span className="sm:hidden">Connect an agent</span>
        <span className="hidden sm:inline">Set up</span>
      </Button>
      <Button variant="ghost" size="sm" onClick={never}>
        Don&apos;t show again
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Hide for now"
        title="Hide for now"
        onClick={() => setHidden(true)}
      >
        <X />
      </Button>
    </div>
  )
}
