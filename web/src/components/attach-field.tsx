import { useEffect, useRef, useState, type ComponentProps, type DragEvent, type Ref } from 'react'
import { Loader2, Paperclip } from 'lucide-react'
import { toast } from 'sonner'
import { useAttach } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatBytes, insertSnippet } from '@/lib/attach'
import { cn } from '@/lib/utils'

/** Where files dropped into a field go. */
export interface AttachTarget {
  project: string
  task: string
  /** The project's attachment root; absent when it cannot take attachments
   *  (a project over ssh). */
  root?: string
  /** The server's cap on one file, in bytes; 0 when not known yet. */
  maxBytes: number
}

export interface AttachFieldProps
  extends Omit<ComponentProps<'textarea'>, 'value' | 'onChange' | 'ref'> {
  target: AttachTarget
  value: string
  onValueChange: (value: string) => void
  /** Told when uploads start and stop, so the form can hold its submit. */
  onBusyChange?: (busy: boolean) => void
  ref?: Ref<HTMLTextAreaElement>
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

/**
 * A markdown textarea that takes files three ways — pasted (a screenshot
 * straight from the clipboard), dropped, or picked with the paperclip — and
 * inserts a link to each where the caret was. The upload writes nothing to
 * the todo file; the link lands there when the form it sits in is saved.
 */
export function AttachField({
  target,
  value,
  onValueChange,
  onBusyChange,
  className,
  ref,
  ...props
}: AttachFieldProps) {
  const box = useRef<HTMLTextAreaElement | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  // An upload finishes after the text may have changed; it inserts into the
  // text as it is then, not as it was when the file was pasted.
  const latest = useRef(value)
  useEffect(() => {
    latest.current = value
  }, [value])

  const [uploading, setUploading] = useState<string[]>([])
  const [over, setOver] = useState(false)
  const attach = useAttach(target.project)
  const enabled = !!target.root

  const busy = uploading.length > 0
  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])

  const setRef = (el: HTMLTextAreaElement | null) => {
    box.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }

  const upload = (files: File[]) => {
    if (files.length === 0) return
    if (!enabled) {
      toast.error('Files cannot be attached here', {
        description: 'Attachments are not available for projects over ssh yet.',
      })
      return
    }
    const tooBig = target.maxBytes > 0 && files.find((f) => f.size > target.maxBytes)
    if (tooBig) {
      toast.error(`${tooBig.name} is too large`, {
        description: `An attachment can be up to ${formatBytes(target.maxBytes)}.`,
      })
      return
    }

    const el = box.current
    const start = el?.selectionStart ?? latest.current.length
    const end = el?.selectionEnd ?? start
    const names = files.map((f) => f.name || 'file')
    setUploading((u) => [...u, ...names])

    // mutateAsync rather than mutate's callbacks, which only fire for the
    // latest call — two quick pastes must both land.
    attach
      .mutateAsync({ id: target.task, files })
      .then(({ attachments }) => {
        const next = insertSnippet(
          latest.current,
          start,
          end,
          attachments.map((a) => a.markdown).join('\n'),
        )
        latest.current = next.text
        onValueChange(next.text)
        requestAnimationFrame(() => {
          box.current?.focus({ preventScroll: true })
          box.current?.setSelectionRange(next.caret, next.caret)
        })
      })
      .catch(() => {
        // the hook has already said what went wrong
      })
      .finally(() =>
        setUploading((u) => {
          const rest = [...u]
          for (const name of names) rest.splice(rest.indexOf(name), 1)
          return rest
        }),
      )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <Textarea
          ref={setRef}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files)
            if (files.length === 0) return
            // Where attaching is off, a paste that also carries text (a file
            // copied in Finder brings its name) pastes that text as usual.
            if (!enabled && e.clipboardData.getData('text/plain')) return
            e.preventDefault()
            upload(files)
          }}
          onDragOver={(e) => {
            if (!hasFiles(e)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = enabled ? 'copy' : 'none'
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            if (!hasFiles(e)) return
            e.preventDefault()
            setOver(false)
            upload(Array.from(e.dataTransfer.files))
          }}
          className={cn(
            enabled && 'pr-10',
            over && enabled && 'border-dashed border-ring ring-3 ring-ring/50',
            className,
          )}
          {...props}
        />
        {enabled && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute right-1.5 bottom-1.5 text-muted-foreground"
              title="Attach files — or paste or drop them into the text"
              aria-label="Attach files"
              onClick={() => picker.current?.click()}
            >
              <Paperclip />
            </Button>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                upload(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
          </>
        )}
      </div>
      {busy && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
          <Loader2 className="size-3 animate-spin" />
          Uploading {uploading.join(', ')}…
        </p>
      )}
    </div>
  )
}
