import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** Phone-sized viewport: the board scrolls one column at a time and task
 *  detail opens as a bottom sheet instead of a dialog. */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)')
}
