import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useCreateTask } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ResponsiveDialog } from '@/components/responsive-dialog'
import { BoardSelect } from '@/components/board-select'
import { parseTags } from '@/lib/tags'

export interface TaskCreateProps {
  project: string
  open: boolean
  onOpenChange: (open: boolean) => void
  boards: string[]
  /** Column the "+" was pressed in. */
  board: string
}

export function TaskCreate({ project, open, onOpenChange, boards, board }: TaskCreateProps) {
  const [target, setTarget] = useState(board)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [due, setDue] = useState('')
  const create = useCreateTask(project)

  useEffect(() => {
    if (open) {
      setTarget(board)
      setTitle('')
      setDescription('')
      setTags('')
      setDue('')
    }
  }, [open, board])

  const submit = () => {
    const trimmed = title.trim()
    if (!trimmed) return
    create.mutate(
      {
        board: target,
        title: trimmed,
        description,
        tags: parseTags(tags),
        due: due || null,
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
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description — markdown, optional"
          aria-label="Description"
          className="min-h-24 font-mono text-[0.8rem]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <BoardSelect value={target} boards={boards} onChange={setTarget} />
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="tags"
            aria-label="Tags"
            className="h-8 w-auto min-w-32 grow text-sm"
          />
          <Input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="Due date"
            className="h-8 w-auto shrink-0 text-sm"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!title.trim() || create.isPending}>
            {create.isPending && <Loader2 className="animate-spin" />}
            Add task
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  )
}
