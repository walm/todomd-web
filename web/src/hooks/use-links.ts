import { createContext, useContext } from 'react'
import type { Board, Task } from '@/api/types'

/** What the cards and the open card need to know about the whole board to
 *  show links. LinksProvider (components/links) supplies it. */
export interface Links {
  boards: readonly Board[]
  /** The cards on the board, by id. */
  tasks: ReadonlyMap<string, Task>
  /** The last board: a card there is finished. */
  last: string | undefined
  /** False when the installed todomd predates links. */
  supported: boolean
  /** Opens a card on this board. */
  open: (id: string) => void
}

export const LinksContext = createContext<Links | null>(null)

export const useLinks = () => useContext(LinksContext)
