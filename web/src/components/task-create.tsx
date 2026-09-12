import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useCreateTask } from '@/api/hooks'
import type { Priority } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AttachField } from '@/components/attach-field'
import { ResponsiveDialog } from '@/components/responsive-dialog'
import { BoardSelect } from '@/components/board-select'
import { PrioritySelect } from '@/components/priority-select'
import { newDraftId } from '@/lib/attach'
import { parseTags } from '@/lib/tags'

export interface TaskCreateProps {
  project: string
  open: boolean
  onOpenChange: (open: boolean) => void
  boards: string[]
  /** Column the "+" was pressed in. */
  board: string
  /** The project's attachment root; absent when it cannot take attachments. */
  attachments?: string
  attachmentMaxBytes: number
}

export function TaskCreate({
  project,
  open,
  onOpenChange,
  boards,
  board,
  attachments,
  attachmentMaxBytes,
}: TaskCreateProps) {
  const [target, setTarget] = useState(board)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [due, setDue] = useState('')
  // The task has no id until it is created, so files pasted while writing it
  // are held under a draft that the create call hands over. A fresh one each
  // time the dialog opens; one abandoned is swept after a day.
  const [draft, setDraft] = useState(newDraftId)
  const [uploading, setUploading] = useState(false)
  const create = useCreateTask(project)

  useEffect(() => {
    if (open) {
      setTarget(board)
      setTitle('')
      setDescription('')
      setTags('')
      setPriority('normal')
      setDue('')
      setDraft(newDraftId())
    }
  }, [open, board])

  const submit = () => {
    const trimmed = title.trim()
    if (!trimmed || uploading) return
    create.mutate(
      {
        board: target,
        title: trimmed,
        description,
        tags: parseTags(tags),
        priority,
        due: due || null,
        draft: attachments ? draft : undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="New task">
      <form
        className="flex flex-col gap-3 pb-1"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
      >
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          aria-label="Title"
          autoFocus
        />
        <AttachField
          target={{
            project,
            to: { draft },
            root: attachments,
            maxBytes: attachmentMaxBytes,
          }}
          value={description}
          onValueChange={setDescription}
          onBusyChange={setUploading}
          placeholder={
            attachments
              ? 'Description — markdown, optional. Paste or drop files to attach.'
              : 'Description — markdown, optional'
          }
          aria-label="Description"
          className="min-h-24 font-mono text-base md:text-[0.8rem]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <BoardSelect value={target} boards={boards} onChange={setTarget} />
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="tags"
            aria-label="Tags"
            className="h-8 w-auto min-w-32 grow text-base md:text-sm"
          />
          <PrioritySelect value={priority} onChange={setPriority} className="w-36 shrink-0" />
          <Input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="Due date"
            className="h-8 w-auto shrink-0 text-base md:text-sm"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={!title.trim() || uploading || create.isPending}
          >
            {create.isPending && <Loader2 className="animate-spin" />}
            Add task
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  )
}
