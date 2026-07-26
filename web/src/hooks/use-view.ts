import { useCallback, useEffect, useState } from 'react'

/** Board is the kanban columns; list is everything in one column, grouped. */
export type View = 'board' | 'list'

const KEY = 'todomd-web:view'

/** Which view to show, remembered per browser — the choice is usually about
 *  the screen you are on, not the project you are looking at. */
export function useView() {
  const [view, setView] = useState<View>(
    () => (localStorage.getItem(KEY) === 'list' ? 'list' : 'board'),
  )

  useEffect(() => {
    localStorage.setItem(KEY, view)
  }, [view])

  const toggle = useCallback(() => setView((v) => (v === 'board' ? 'list' : 'board')), [])

  return { view, setView, toggle }
}
