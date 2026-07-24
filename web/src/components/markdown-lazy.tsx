import { Suspense, lazy } from 'react'
import type { MarkdownProps } from '@/components/markdown'
import { cn } from '@/lib/utils'

// react-markdown and highlight.js together are most of the bundle, and
// nothing on the board needs them — only an open task does. Loading them on
// first use keeps the board's first paint small; the chunk comes off
// localhost, so the fallback is on screen for a frame or two.
const MarkdownImpl = lazy(() =>
  import('@/components/markdown').then((m) => ({ default: m.Markdown })),
)

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <Suspense
      fallback={
        <div className={cn('text-sm leading-relaxed whitespace-pre-wrap', className)}>
          {children}
        </div>
      }
    >
      <MarkdownImpl className={className}>{children}</MarkdownImpl>
    </Suspense>
  )
}
