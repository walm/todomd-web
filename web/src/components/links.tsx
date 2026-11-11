import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { Popover } from '@base-ui/react/popover'
import { AtSign, Ban, CheckCircle2, CircleDot, Link2, Plus, Search, X } from 'lucide-react'
import type { Board, Link, LinkKind, Task } from '@/api/types'
import { useLinkTask, useUnlinkTask } from '@/api/hooks'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { LinksContext, useLinks, type Links } from '@/hooks/use-links'
import { useIsMobile } from '@/hooks/use-media-query'
import {
  LINK_LABEL,
  PICK_KINDS,
  lastBoard,
  linkDone,
  linkMarks,
  linksSupported,
} from '@/lib/links'
import { mentionedIn, mentionsOn } from '@/lib/mentions'
import { cn } from '@/lib/utils'

// --- The board's links ------------------------------------------------------

export function LinksProvider({
  boards,
  onOpen,
  children,
}: {
  boards: readonly Board[]
  onOpen: (task: Task) => void
  children: ReactNode
}) {
  const value = useMemo<Links>(() => {
    const tasks = new Map(boards.flatMap((b) => b.tasks.map((t) => [t.id, t] as const)))
    return {
      boards,
      tasks,
      last: lastBoard(boards),
      supported: linksSupported(boards),
      open: (id) => {
        const t = tasks.get(id)
        if (t) onOpen(t)
      },
    }
  }, [boards, onOpen])
  return <LinksContext.Provider value={value}>{children}</LinksContext.Provider>
}

/** On a board card: "blocked" in amber while a blocker is open, and a quiet
 *  link count. */
export function LinkMarks({ task }: { task: Task }) {
  const links = useLinks()
  const marks = linkMarks(task, links?.last)
  if (!marks) return null
  return (
    <>
      {marks.blocked && (
        <span
          className="inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap text-amber-700 dark:text-amber-400"
          title="Blocked by an open card"
        >
          <Ban className="size-3" aria-hidden />
          blocked
        </span>
      )}
      <span
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        title={marks.count === 1 ? '1 linked card' : `${marks.count} linked cards`}
      >
        <Link2 className="size-3" aria-hidden />
        {marks.count}
        <span className="sr-only">{marks.count === 1 ? ' link' : ' links'}</span>
      </span>
    </>
  )
}

// --- An open card -----------------------------------------------------------

/** Where the other card is: its board (done or open), or gone. */
function Status({ board, done }: { board: string | null; done: boolean }) {
  if (board === null) {
    return <span className="shrink-0 text-[11px] text-muted-foreground">not on the board</span>
  }
  return (
    <span className="inline-flex max-w-32 shrink-0 items-center gap-1 truncate rounded-full border px-1.5 py-px text-[11px] text-muted-foreground">
      {done ? (
        <CheckCircle2 className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      ) : (
        <CircleDot className="size-3 shrink-0" aria-hidden />
      )}
      <span className="truncate">{board}</span>
    </span>
  )
}

interface PickerState {
  /** A card to start with, selected (Make link). */
  to?: string
  kind: LinkKind
}

/**
 * The open card's links, both ways, grouped by kind as todomd orders them;
 * then the cards whose text mentions this one but that aren't linked yet
 * ("Mentioned in"), each with Make link.
 */
export function LinksSection({ project, task }: { project: string; task: Task }) {
  const links = useLinks()
  const mobile = useIsMobile()
  const unlink = useUnlinkTask(project)
  const link = useLinkTask(project)
  const [picker, setPicker] = useState<PickerState | null>(null)
  const views = useMemo(() => task.links ?? [], [task.links])
  const mentions = useMemo(() => {
    if (!links) return []
    const linked = new Set(views.map((v) => v.id))
    return mentionedIn(links.boards, task.id).filter((t) => !linked.has(t.id))
  }, [links, task.id, views])
  if (!links) return null

  if (!links.supported) {
    return (
      <p className="text-xs text-muted-foreground">
        Card links need todomd v0.14.0 or newer — run{' '}
        <code className="rounded bg-muted px-1 font-mono">todomd upgrade</code>.
      </p>
    )
  }

  const remove = (v: Link) => unlink.mutate({ id: task.id, to: v.id, kind: v.kind })

  return (
    <section className="flex flex-col gap-2" aria-label="Links">
      <div className="flex min-h-7 items-center gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Links {views.length > 0 && <span className="font-normal">{views.length}</span>}
        </h3>
        <div className="grow" />
        <LinkPicker
          task={task}
          state={picker}
          mobile={mobile}
          onOpenChange={(open) => setPicker(open ? { kind: 'related' } : null)}
          onPick={(kind, to) => {
            setPicker(null)
            link.mutate({ id: task.id, kind, to })
          }}
        />
      </div>

      {views.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border">
          {views.map((v, i) => {
            const onBoard = v.board !== null
            const done = linkDone(v, links.last)
            const amber = v.kind === 'blocked by' && onBoard && !done
            const first = i === 0 || views[i - 1].kind !== v.kind
            const name = onBoard ? (
              <button
                type="button"
                onClick={() => links.open(v.id)}
                className={cn(
                  'max-w-full truncate rounded-sm text-left font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50',
                  mobile && 'whitespace-normal wrap-anywhere',
                  done && 'text-muted-foreground line-through decoration-muted-foreground/50',
                )}
              >
                {v.title}
              </button>
            ) : (
              <span className="text-muted-foreground">A card that is no longer on the board</span>
            )
            const kind = (
              <span
                className={cn(
                  'text-xs text-muted-foreground',
                  amber && 'font-medium text-amber-700 dark:text-amber-400',
                )}
              >
                {LINK_LABEL[v.kind]}
              </span>
            )
            const x = (
              <button
                type="button"
                aria-label={`Remove the link to ${v.id}`}
                title="Remove link"
                disabled={unlink.isPending}
                onClick={() => remove(v)}
                className={cn(
                  'shrink-0 rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                  mobile
                    ? '-mr-1 p-2'
                    : '-mr-1 p-1 opacity-0 group-hover/link:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
                )}
              >
                <X className={mobile ? 'size-4' : 'size-3.5'} />
              </button>
            )
            if (mobile) {
              return (
                <li
                  key={`${v.kind} ${v.id}`}
                  data-link={v.id}
                  className="flex min-w-0 items-center gap-2 px-3 py-2.5"
                >
                  <div className="flex min-w-0 grow flex-col gap-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      {kind}
                      <span className="font-mono text-xs text-muted-foreground">{v.id}</span>
                      <Status board={v.board} done={done} />
                    </span>
                    <span className="text-sm leading-snug">{name}</span>
                  </div>
                  {x}
                </li>
              )
            }
            return (
              <li
                key={`${v.kind} ${v.id}`}
                data-link={v.id}
                className="group/link flex min-w-0 items-center gap-2.5 px-2.5 py-2"
              >
                <span className={cn('w-24 shrink-0', !first && 'invisible')}>{kind}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{v.id}</span>
                <span className="flex min-w-0 grow text-sm">{name}</span>
                <Status board={v.board} done={done} />
                {x}
              </li>
            )
          })}
        </ul>
      )}

      {mentions.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AtSign className="size-3" aria-hidden /> Mentioned in
          </p>
          <ul className="flex flex-col">
            {mentions.map((card) => (
              <li
                key={card.id}
                className="flex min-w-0 items-center gap-2.5 py-1 pointer-coarse:py-1.5"
              >
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{card.id}</span>
                <button
                  type="button"
                  onClick={() => links.open(card.id)}
                  className="min-w-0 grow truncate rounded-sm text-left text-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {card.title}
                </button>
                <button
                  type="button"
                  onClick={() => setPicker({ to: card.id, kind: 'related' })}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:px-2 pointer-coarse:py-1"
                >
                  <Link2 className="size-3" aria-hidden />
                  Make link
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// --- The picker -------------------------------------------------------------

/**
 * "Link a card": a kind, then a card. A popover under the button on a
 * laptop, driven by the keys (↑↓ ↵ esc); a bottom sheet on a phone. Cards
 * this one mentions come first.
 */
function LinkPicker({
  task,
  state,
  mobile,
  onOpenChange,
  onPick,
}: {
  task: Task
  state: PickerState | null
  mobile: boolean
  onOpenChange: (open: boolean) => void
  onPick: (kind: LinkKind, to: string) => void
}) {
  const triggerClass =
    'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-9'
  const label = (
    <>
      <Plus className="size-3.5" aria-hidden />
      Link a card
    </>
  )
  const search = useRef<HTMLInputElement>(null)
  const open = state !== null
  // A new body per opening: kind, search and selection start fresh.
  const body = open && (
    <PickerBody
      key={state.to ?? ''}
      task={task}
      initial={state}
      mobile={mobile}
      search={search}
      onPick={onPick}
      onClose={() => onOpenChange(false)}
    />
  )

  if (mobile) {
    return (
      <>
        <button type="button" className={triggerClass} onClick={() => onOpenChange(true)}>
          {label}
        </button>
        <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
          <DrawerContent className="h-[78dvh]">
            <div className="flex items-center justify-between px-4 pt-1">
              <DrawerTitle className="text-base font-semibold">Link a card</DrawerTitle>
              <button
                type="button"
                aria-label="Close"
                onClick={() => onOpenChange(false)}
                className="-mr-2 rounded-md p-2 text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            {body}
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger render={<button type="button" className={triggerClass} />}>
        {label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 outline-none"
        >
          <Popover.Popup
            initialFocus={search}
            aria-label="Link a card"
            className="flex max-h-[min(440px,var(--available-height))] w-[440px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl transition-opacity outline-none data-ending-style:opacity-0 data-starting-style:opacity-0"
          >
            {body}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Every space-separated term in the title, or the query is an id prefix. */
function matches(t: Task, q: string): boolean {
  if (!q) return true
  if (t.id.startsWith(q)) return true
  const title = t.title.toLowerCase()
  return q.split(/\s+/).every((term) => title.includes(term))
}

function PickerBody({
  task,
  initial,
  mobile,
  search,
  onPick,
  onClose,
}: {
  task: Task
  initial: PickerState
  mobile: boolean
  search: RefObject<HTMLInputElement | null>
  onPick: (kind: LinkKind, to: string) => void
  onClose: () => void
}) {
  const links = useLinks()!
  const [kind, setKind] = useState<LinkKind>(initial.kind)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string | null>(initial.to ?? null)
  const list = useRef<HTMLDivElement>(null)

  const linked = new Set((task.links ?? []).map((v) => v.id))
  const { suggested, rest } = useMemo(() => {
    const others = [...links.tasks.values()].filter((t) => t.id !== task.id)
    const named = mentionsOn(task, (id) => links.tasks.has(id))
    const q = query.trim().replace(/^#/, '').toLowerCase()
    const hits = others.filter((t) => matches(t, q))
    if (q) hits.sort((a, b) => Number(b.id.startsWith(q)) - Number(a.id.startsWith(q)))
    return {
      suggested: hits.filter((t) => named.has(t.id)),
      rest: hits.filter((t) => !named.has(t.id)),
    }
  }, [links, task, query])
  const flat = [...suggested, ...rest]
  const current = flat.find((t) => t.id === active) ?? flat[0]

  // Make link starts on its card: bring it into view.
  useEffect(() => {
    if (!initial.to) return
    // After the popover or sheet has its size, or "nearest" lands short.
    const frame = requestAnimationFrame(() =>
      list.current
        ?.querySelector(`[data-pick="${initial.to}"]`)
        ?.scrollIntoView?.({ block: 'center' }),
    )
    return () => cancelAnimationFrame(frame)
  }, [initial.to])

  const move = (by: number) => {
    if (flat.length === 0) return
    const at = current ? flat.indexOf(current) : -1
    const next = flat[(at + by + flat.length) % flat.length]
    setActive(next.id)
    list.current
      ?.querySelector(`[data-pick="${next.id}"]`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'Enter' && current) {
      e.preventDefault()
      onPick(kind, current.id)
    } else if (e.key === 'Escape') {
      // Close the picker, not the card under it.
      e.stopPropagation()
      e.preventDefault()
      onClose()
    }
  }

  const row = (t: Task) => {
    const done = t.board === links.last
    return (
      <button
        key={t.id}
        type="button"
        role="option"
        aria-selected={t === current}
        data-pick={t.id}
        onMouseMove={() => setActive(t.id)}
        onClick={() => onPick(kind, t.id)}
        className={cn(
          'flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none',
          t === current && 'bg-muted',
        )}
      >
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{t.id}</span>
        <span className={cn('min-w-0 grow truncate', done && 'text-muted-foreground')}>
          {t.title}
        </span>
        {linked.has(t.id) ? (
          <span className="shrink-0 text-xs text-muted-foreground">linked</span>
        ) : (
          <Status board={t.board} done={done} />
        )}
      </button>
    )
  }

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 border-b p-3">
        <p className="truncate text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{task.title}</span> …
        </p>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Kind of link">
          {PICK_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={k === kind}
              onClick={() => {
                setKind(k)
                // Back to the search, so typing and ↵ go on (not on a phone:
                // that would pop the keyboard up).
                if (!mobile) search.current?.focus()
              }}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:px-3 pointer-coarse:py-1.5 pointer-coarse:text-sm',
                k === kind
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <label className="flex shrink-0 items-center gap-2 border-b px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={search}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(null)
          }}
          onKeyDown={onKeyDown}
          placeholder="Search cards by title or id…"
          aria-label="Search cards"
          className="h-11 min-w-0 grow bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
      </label>
      <div
        ref={list}
        role="listbox"
        aria-label="Cards"
        className="min-h-0 grow overflow-y-auto p-1.5"
      >
        {suggested.length > 0 && (
          <>
            <p className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground">
              Mentioned on this card
            </p>
            {suggested.map(row)}
          </>
        )}
        {rest.length > 0 && (
          <>
            <p className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground">Cards</p>
            {rest.map(row)}
          </>
        )}
        {flat.length === 0 && (
          <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">
            No card matches
          </p>
        )}
      </div>
      {!mobile && (
        <div className="flex shrink-0 items-center justify-between gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
          <span className="truncate">
            Saved on this card as{' '}
            <code className="rounded bg-muted px-1 font-mono">
              - {kind} {current?.id ?? 'id'}
            </code>
          </span>
          <span className="shrink-0">↵ to link · esc to close</span>
        </div>
      )}
    </>
  )
}
