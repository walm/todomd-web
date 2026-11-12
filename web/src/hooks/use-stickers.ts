import { createContext, useContext } from 'react'
import type { Task } from '@/api/types'

/** What cards need to show and set stickers. StickersProvider
 *  (components/stickers) supplies it. */
export interface Stickers {
  /** False when the installed todomd predates stickers (v0.15.0). */
  supported: boolean
  /** Opens the picker for a card, next to anchor (a bottom sheet on a phone). */
  pick: (task: Task, anchor: Element | null) => void
}

export const StickersContext = createContext<Stickers | null>(null)

export const useStickers = () => useContext(StickersContext)
