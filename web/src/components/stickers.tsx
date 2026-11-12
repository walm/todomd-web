import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react'
import { Popover } from '@base-ui/react/popover'
import { SmilePlus, X } from 'lucide-react'
import type { Board, StickerName, Task } from '@/api/types'
import { useSetSticker } from '@/api/hooks'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { useIsMobile } from '@/hooks/use-media-query'
import { StickersContext, useStickers, type Stickers } from '@/hooks/use-stickers'
import {
  EMOJI_STICKERS,
  RIBBONS,
  RIBBON_COLOR,
  stickerLabel,
  stickerOf,
  stickersSupported,
  type Sticker,
} from '@/lib/stickers'
import { cn } from '@/lib/utils'

// --- The board's stickers ---------------------------------------------------

interface Picking {
  id: string
  anchor: Element | null
}

/**
 * Stickers for the board: whether todomd can store them, and the one picker
 * every card, the open card and the `s` key share — a popover next to what
 * opened it on a laptop, a bottom sheet on a phone.
 */
export function StickersProvider({
  project,
  boards,
  children,
}: {
  project: string | undefined
  boards: readonly Board[]
  children: ReactNode
}) {
  const [picking, setPicking] = useState<Picking | null>(null)
  const supported = stickersSupported(boards)
  const editable = supported && !!project
  const pick = useCallback(
    (task: Task, anchor: Element | null) => setPicking({ id: task.id, anchor }),
    [],
  )
  const value = useMemo<Stickers>(() => ({ supported: editable, pick }), [editable, pick])

  // `s` on the card the pointer is over or the keyboard is on; with a card
  // open, on that card.
  useEffect(() => {
    if (!editable) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 's' || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (target?.isContentEditable) return
      const chip = document.querySelector<HTMLElement>('[data-sticker-chip]')
      const card = chip
        ? null
        : (document.activeElement?.closest<HTMLElement>('[data-task]') ??
          [...document.querySelectorAll<HTMLElement>('[data-task]:hover')].pop())
      const id = chip?.dataset.stickerChip ?? card?.dataset.task
      if (!id) return
      e.preventDefault()
      setPicking({ id, anchor: chip ?? card ?? null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editable])

  const task = picking
    ? boards.flatMap((b) => b.tasks).find((t) => t.id === picking.id)
    : undefined

  return (
    <StickersContext.Provider value={value}>
      {children}
      {project && (
        <StickerPicker
          project={project}
          task={task}
          anchor={picking?.anchor ?? null}
          onClose={() => setPicking(null)}
        />
      )}
    </StickersContext.Provider>
  )
}

// --- On a card --------------------------------------------------------------

/** Keeps a press on the sticker from starting a drag or opening the card. */
const own = {
  onPointerDown: (e: SyntheticEvent) => e.stopPropagation(),
  onTouchStart: (e: SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: SyntheticEvent) => e.stopPropagation(),
}

/** A sticker's look on its own: the emoji, or a ribbon swatch. */
export function StickerGlyph({ sticker, className }: { sticker: Sticker; className?: string }) {
  if (sticker.kind === 'emoji') {
    return (
      <span aria-hidden className={cn('leading-none', className)}>
        {sticker.emoji}
      </span>
    )
  }
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-block size-3.5 shrink-0 overflow-hidden rounded-[3px] border bg-background',
        className,
      )}
    >
      <span
        className={cn(
          'absolute top-[3px] right-[3px] h-[4px] w-6 translate-x-1/2 -translate-y-1/2 rotate-45',
          RIBBON_COLOR[sticker.name],
        )}
      />
    </span>
  )
}

/**
 * The top-right corner of a board card or a list row: the emoji sticking out
 * over the corner, or a ribbon across it; with none, a ☺+ that shows on
 * hover. Either opens the picker. The card has to be `relative`.
 */
export function StickerCorner({ task, size = 'card' }: { task: Task; size?: 'card' | 'row' }) {
  const stickers = useStickers()
  const sticker = stickerOf(task)
  const button = useRef<HTMLButtonElement>(null)
  if (!sticker && !stickers?.supported) return null
  const editable = !!stickers?.supported
  const open = (e: React.MouseEvent) => {
    e.stopPropagation()
    stickers?.pick(task, button.current)
  }
  const label = sticker
    ? `Sticker: ${stickerLabel(sticker)} — change it`
    : 'Add a sticker'

  if (sticker?.kind === 'ribbon') {
    const box = size === 'row' ? 'size-8' : 'size-11'
    return (
      <button
        ref={button}
        type="button"
        aria-label={label}
        title={editable ? `${stickerLabel(sticker)} — s to change` : stickerLabel(sticker)}
        disabled={!editable}
        onClick={open}
        {...own}
        data-sticker={sticker.name}
        className={cn(
          'absolute top-0 right-0 overflow-hidden rounded-tr-[inherit] outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          box,
        )}
      >
        <span
          className={cn(
            'absolute w-20 translate-x-1/2 -translate-y-1/2 rotate-45 shadow-xs',
            size === 'row' ? 'top-[9px] right-[9px] h-2' : 'top-[12px] right-[12px] h-3',
            RIBBON_COLOR[sticker.name],
          )}
        />
      </button>
    )
  }

  const disc = cn(
    'absolute z-[1] grid place-items-center rounded-full border bg-card shadow-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
    size === 'row' ? '-top-2 -right-2 size-6 text-xs' : '-top-1.5 -right-1.5 size-7 text-[15px]',
  )
  if (sticker) {
    return (
      <button
        ref={button}
        type="button"
        aria-label={label}
        title={editable ? `${stickerLabel(sticker)} — s to change` : stickerLabel(sticker)}
        disabled={!editable}
        onClick={open}
        {...own}
        data-sticker={sticker.name}
        className={cn(disc, editable && 'hover:scale-110 transition-transform')}
      >
        <StickerGlyph sticker={sticker} />
      </button>
    )
  }
  // Nothing yet: only on hover (or keyboard focus), and never on touch,
  // where a long press opens the picker instead.
  return (
    <button
      ref={button}
      type="button"
      aria-label={label}
      title="Add a sticker — s"
      onClick={open}
      {...own}
      className={cn(
        disc,
        'text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 pointer-coarse:hidden',
      )}
    >
      <SmilePlus className={size === 'row' ? 'size-3.5' : 'size-4'} />
    </button>
  )
}

// --- On the open card -------------------------------------------------------

/** Next to the board select on an open card: the sticker, or a quiet
 *  "Sticker" to add one. With a todomd that has no stickers, it says so. */
export function StickerChip({ task }: { task: Task }) {
  const stickers = useStickers()
  const sticker = stickerOf(task)
  const ref = useRef<HTMLButtonElement>(null)
  const [note, setNote] = useState(false)
  if (!stickers) return null

  const base =
    'inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

  if (!stickers.supported) {
    return (
      <Popover.Root open={note} onOpenChange={setNote}>
        <Popover.Trigger
          render={
            <button
              type="button"
              className={cn(base, 'text-muted-foreground hover:bg-muted hover:text-foreground')}
            />
          }
        >
          <SmilePlus className="size-4" aria-hidden />
          Sticker
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
            <Popover.Popup className="max-w-72 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-lg outline-none">
              Stickers need todomd v0.15.0 or newer — run{' '}
              <code className="rounded bg-muted px-1 font-mono">todomd upgrade</code>.
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    )
  }

  return (
    <button
      ref={ref}
      type="button"
      data-sticker-chip={task.id}
      onClick={() => stickers.pick(task, ref.current)}
      title="Change the sticker — s"
      className={cn(
        base,
        sticker
          ? 'border bg-background hover:bg-muted'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {sticker ? (
        <>
          <StickerGlyph sticker={sticker} className={sticker.kind === 'emoji' ? 'text-base' : ''} />
          <span className="text-muted-foreground">{sticker.name}</span>
        </>
      ) : (
        <>
          <SmilePlus className="size-4" aria-hidden />
          Sticker
        </>
      )}
    </button>
  )
}

// --- The picker -------------------------------------------------------------

function StickerPicker({
  project,
  task,
  anchor,
  onClose,
}: {
  project: string
  task: Task | undefined
  anchor: Element | null
  onClose: () => void
}) {
  const mobile = useIsMobile()
  const set = useSetSticker(project)
  const open = !!task
  const choose = (name: StickerName | null) => {
    if (task && (task.sticker ?? null) !== name) set.mutate({ id: task.id, sticker: name })
    onClose()
  }
  const onOpenChange = (next: boolean) => !next && onClose()
  // The last card stays rendered while the popover fades out.
  const last = useRef(task)
  if (task) last.current = task
  const shown = task ?? last.current
  const body = shown && (
    <PickerBody task={shown} mobile={mobile} onPick={choose} onClose={onClose} />
  )

  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
        <DrawerContent>
          <div className="flex items-start justify-between gap-2 px-4 pt-1">
            <div className="min-w-0">
              <DrawerTitle className="text-base font-semibold">Sticker</DrawerTitle>
              <p className="truncate text-sm text-muted-foreground">{shown?.title}</p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="-mr-2 rounded-md p-2 text-muted-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          {body}
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 outline-none"
        >
          <Popover.Popup
            aria-label="Sticker"
            className="w-[296px] max-w-[calc(100vw-2rem)] rounded-xl border bg-popover text-popover-foreground shadow-xl transition-opacity outline-none data-ending-style:opacity-0 data-starting-style:opacity-0"
          >
            {body}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

const kbd = 'rounded border bg-muted px-1 font-mono text-[10px] leading-4 text-muted-foreground'

/** Emoji, ribbons, No sticker. 1–9 pick the first nine emoji and 0 clears;
 *  the arrows walk the grid. */
function PickerBody({
  task,
  mobile,
  onPick,
  onClose,
}: {
  task: Task
  mobile: boolean
  onPick: (name: StickerName | null) => void
  onClose: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const current = task.sticker ?? null

  // Start on the card's sticker (or the first emoji), so the arrows and ↵
  // work from the first key.
  useEffect(() => {
    if (mobile) return
    const frame = requestAnimationFrame(() => {
      const el =
        root.current?.querySelector<HTMLElement>('[aria-checked="true"]') ??
        root.current?.querySelector<HTMLElement>('[data-pick]')
      el?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [mobile])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (/^[1-9]$/.test(e.key)) {
      e.preventDefault()
      onPick(EMOJI_STICKERS[Number(e.key) - 1].name)
    } else if (e.key === '0') {
      e.preventDefault()
      onPick(null)
    } else if (e.key === 'Escape') {
      // Close the picker, not the card under it.
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (/^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
      const all = [...(root.current?.querySelectorAll<HTMLElement>('[data-pick]') ?? [])]
      const at = all.indexOf(document.activeElement as HTMLElement)
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -6, ArrowDown: 6 }[e.key]!
      const next = all[Math.min(all.length - 1, Math.max(0, at < 0 ? 0 : at + step))]
      if (next) {
        e.preventDefault()
        next.focus()
      }
    }
  }

  const tile = (s: Sticker, i: number) => {
    const on = s.name === current
    return (
      <button
        key={s.name}
        type="button"
        role="radio"
        aria-checked={on}
        aria-label={stickerLabel(s)}
        title={s.kind === 'emoji' && i < 9 ? `${s.name} — ${i + 1}` : stickerLabel(s)}
        data-pick={s.name}
        onClick={() => onPick(s.name)}
        className={cn(
          'grid place-items-center rounded-lg border border-transparent outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          mobile ? 'h-12' : 'h-10',
          on && 'border-border bg-muted',
        )}
      >
        {s.kind === 'emoji' ? (
          <span aria-hidden className={mobile ? 'text-[28px]' : 'text-[22px]'}>
            {s.emoji}
          </span>
        ) : (
          <span
            aria-hidden
            className={cn(
              'relative overflow-hidden rounded-md border bg-background',
              mobile ? 'size-11' : 'size-9',
            )}
          >
            <span
              className={cn(
                'absolute top-[7px] right-[7px] h-2 w-12 translate-x-1/2 -translate-y-1/2 rotate-45',
                RIBBON_COLOR[s.name],
              )}
            />
          </span>
        )}
      </button>
    )
  }

  return (
    <div
      ref={root}
      onKeyDown={onKeyDown}
      className={cn('flex flex-col', mobile ? 'gap-2 px-4 pt-2 pb-6' : 'gap-1.5 p-3')}
    >
      {!mobile && (
        <div className="flex items-center justify-between pb-0.5">
          <span className="text-sm font-semibold">Sticker</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <kbd className={kbd}>s</kbd> on a card
          </span>
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Emoji</span>
        {!mobile && <span>1–9</span>}
      </div>
      <div role="radiogroup" aria-label="Emoji" className="grid grid-cols-6 gap-1">
        {EMOJI_STICKERS.map(tile)}
      </div>
      <div className="pt-1 text-xs text-muted-foreground">Ribbon</div>
      <div role="radiogroup" aria-label="Ribbon" className="grid grid-cols-6 gap-1">
        {RIBBONS.map(tile)}
      </div>
      <div className="mt-1 border-t pt-1.5">
        <button
          type="button"
          data-pick="none"
          onClick={() => onPick(null)}
          className={cn(
            'flex w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
            mobile ? 'h-11' : 'h-8',
          )}
        >
          <X className="size-4" aria-hidden />
          <span className="grow">No sticker</span>
          {!mobile && <kbd className={kbd}>0</kbd>}
        </button>
      </div>
    </div>
  )
}
