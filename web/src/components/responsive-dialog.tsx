import { useEffect, useRef, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { useIsMobile } from '@/hooks/use-media-query'
import { cn } from '@/lib/utils'

export interface ResponsiveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}

/** A dialog on a laptop, a swipe-to-dismiss bottom sheet on a phone. */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: ResponsiveDialogProps) {
  const mobile = useIsMobile()
  const body = useRef<HTMLDivElement>(null)

  // Whatever takes focus inside (the comment box does), the content starts at
  // the top: a card that opens already scrolled to its footer is disorienting.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      if (body.current) body.current.scrollTop = 0
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
        <DrawerContent className={cn('max-h-[92dvh]', className)}>
          <DrawerHeader className="text-left">
            <DrawerTitle className="pr-8 wrap-anywhere">{title}</DrawerTitle>
            {description ? (
              <DrawerDescription>{description}</DrawerDescription>
            ) : (
              <DrawerDescription className="sr-only">Task details</DrawerDescription>
            )}
          </DrawerHeader>
          <div
            ref={body}
            className="min-h-0 grow overflow-y-auto overscroll-contain px-4 pb-6"
          >
            {children}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn('flex max-h-[85vh] flex-col gap-3 sm:max-w-2xl', className)}
      >
        <DialogHeader>
          <DialogTitle className="pr-8 text-base wrap-anywhere">{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">Task details</DialogDescription>
          )}
        </DialogHeader>
        <div ref={body} className="-mx-1 min-h-0 grow overflow-y-auto px-1">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
}
