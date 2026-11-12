import { useRef, type TouchEvent } from 'react'

const HOLD_MS = 450
const SLOP_PX = 8

/**
 * A long press on a touch screen: a finger held still for a moment and then
 * lifted. It fires on release, not while the finger is down, so it never
 * competes with a drag (which needs the finger to move) or a scroll. The
 * browser's click after it is cancelled, and `swallowClick` catches one that
 * gets through anyway.
 */
export function useLongPress(onLongPress: (() => void) | undefined) {
  const start = useRef<{ x: number; y: number; at: number } | null>(null)
  const fired = useRef(0)

  return {
    handlers: {
      onTouchStart: (e: TouchEvent) => {
        const t = e.touches[0]
        start.current =
          onLongPress && e.touches.length === 1 ? { x: t.clientX, y: t.clientY, at: Date.now() } : null
      },
      onTouchMove: (e: TouchEvent) => {
        const s = start.current
        const t = e.touches[0]
        if (s && t && Math.hypot(t.clientX - s.x, t.clientY - s.y) > SLOP_PX) start.current = null
      },
      onTouchEnd: (e: TouchEvent) => {
        const s = start.current
        start.current = null
        if (s && onLongPress && Date.now() - s.at >= HOLD_MS) {
          // No click after it: it would land on the sheet's backdrop, which
          // has just opened under the finger, and close it again.
          e.preventDefault()
          fired.current = Date.now()
          onLongPress()
        }
      },
      onTouchCancel: () => {
        start.current = null
      },
    },
    /** True for the click that follows a long press. */
    swallowClick: () => Date.now() - fired.current < 700,
  }
}
