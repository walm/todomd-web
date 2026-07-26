import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Loader2, MessageSquarePlus, Pencil, Trash2 } from 'lucide-react'
import type { Priority, Task } from '@/api/types'
import { useAddComment, useDeleteTask, useMoveTask, useUpdateTask } from '@/api/hooks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Markdown } from '@/components/markdown-lazy'
import { ResponsiveDialog } from '@/components/responsive-dialog'
import { BoardSelect } from '@/components/board-select'
import { PriorityMark } from '@/components/priority-mark'
import { PrioritySelect } from '@/components/priority-select'
import { useIsMobile } from '@/hooks/use-media-query'
import { dueUrgency, formatDue } from '@/lib/due'
import { parseTags } from '@/lib/tags'
import { cn } from '@/lib/utils'

const AUTHOR_KEY = 'todomd-web:author'

export interface TaskDetailProps {
  project: string
  task: Task
  boards: string[]
  defaultAuthor: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TaskDetail({
  project,
  task,
  boards,
  defaultAuthor,
  open,
  onOpenChange,
}: TaskDetailProps) {
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const update = useUpdateTask(project)
  const move = useMoveTask(project)
  const remove = useDeleteTask(project)

  // Leave edit mode when a different task is opened.
  useEffect(() => {
    setEditing(false)
    setConfirmDelete(false)
  }, [task.id])

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-baseline gap-2">
          {task.title}
          <span className="shrink-0 font-mono text-xs font-normal text-muted-foreground">
            {task.id}
          </span>
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <BoardSelect
            value={task.board}
            boards={boards}
            onChange={(board) => move.mutate({ id: task.id, to: board, pos: 0 })}
            disabled={move.isPending}
          />
          {!editing && <PriorityMark priority={task.priority} />}
          {task.due && !editing && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs',
                dueUrgency(task.due) === 'overdue'
                  ? 'text-destructive'
                  : dueUrgency(task.due) === 'soon'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-muted-foreground',
              )}
              title={task.due}
            >
              <CalendarDays className="size-3.5" />
              {formatDue(task.due)}
            </span>
          )}
          {!editing &&
            task.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="font-normal">
                {tag}
              </Badge>
            ))}
          <div className="grow" />
          {!editing && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil />
              Edit
            </Button>
          )}
        </div>

        {editing ? (
          <TaskFields
            task={task}
            saving={update.isPending}
            onCancel={() => setEditing(false)}
            onSave={(patch) =>
              update.mutate(
                { id: task.id, patch },
                { onSuccess: () => setEditing(false) },
              )
            }
          />
        ) : task.description ? (
          <Markdown>{task.description}</Markdown>
        ) : (
          <p className="text-sm text-muted-foreground italic">No description</p>
        )}

        <Comments project={project} task={task} defaultAuthor={defaultAuthor} />

        <div className="flex items-center justify-end gap-2 border-t pt-3">
          {confirmDelete ? (
            <>
              <span className="mr-auto text-sm text-muted-foreground">
                Delete this task?
              </span>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(task.id, { onSuccess: () => onOpenChange(false) })
                }
              >
                {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
                Delete
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 />
              Delete
            </Button>
          )}
        </div>
      </div>
    </ResponsiveDialog>
  )
}

interface TaskFieldsProps {
  task: Task
  saving: boolean
  onSave: (patch: {
    title: string
    description: string
    tags: string[]
    priority: Priority
    due: string | null
  }) => void
  onCancel: () => void
}

/** The edit form. Tags are a comma/space separated list, matching how they
 *  read in the file (`#core #parser`). */
function TaskFields({ task, saving, onSave, onCancel }: TaskFieldsProps) {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [tags, setTags] = useState(task.tags.join(' '))
  const [priority, setPriority] = useState<Priority>(task.priority)
  const [due, setDue] = useState(task.due ?? '')

  const submit = () =>
    onSave({
      title: title.trim(),
      description,
      tags: parseTags(tags),
      priority,
      due: due || null,
    })

  return (
    <form
      className="flex flex-col gap-3"
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
        aria-label="Title"
        placeholder="Title"
        autoFocus
      />
      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        aria-label="Description"
        placeholder="Description — markdown, kept verbatim in the file"
        className="min-h-32 font-mono text-base md:text-[0.8rem]"
      />
      <div className="flex flex-wrap gap-2">
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          aria-label="Tags"
          placeholder="tags, space separated"
          className="w-auto min-w-40 grow"
        />
        <PrioritySelect value={priority} onChange={setPriority} className="w-36 shrink-0" />
        <Input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="Due date"
          className="w-auto shrink-0"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving || !title.trim()}>
          {saving && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  )
}

function Comments({
  project,
  task,
  defaultAuthor,
}: {
  project: string
  task: Task
  defaultAuthor: string
}) {
  const [text, setText] = useState('')
  const [author, setAuthor] = useState(
    () => localStorage.getItem(AUTHOR_KEY) ?? defaultAuthor,
  )
  const add = useAddComment(project)
  const box = useRef<HTMLTextAreaElement>(null)
  const mobile = useIsMobile()

  // Replying is the common reason to open a card, so the comment box takes
  // focus — but with preventScroll, so the card still opens at the top rather
  // than jumped to the bottom. Not on a phone: there it would throw the
  // keyboard over the task you just opened.
  useEffect(() => {
    if (mobile) return
    const frame = requestAnimationFrame(() => box.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [task.id, mobile])

  const submit = () => {
    const body = text.trim()
    if (!body) return
    localStorage.setItem(AUTHOR_KEY, author)
    add.mutate({ id: task.id, author, text: body }, { onSuccess: () => setText('') })
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Comments
      </h3>
      {task.comments.length === 0 && (
        <p className="text-sm text-muted-foreground italic">No comments yet</p>
      )}
      {task.comments.map((comment, i) => (
        <article key={i} className="rounded-lg bg-muted/60 p-2.5">
          <p className="mb-1 flex items-baseline gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{comment.author}</span>
            {comment.date}
          </p>
          <Markdown>{comment.text}</Markdown>
        </article>
      ))}

      <div className="flex flex-col gap-2">
        <Textarea
          ref={box}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a comment…"
          aria-label="New comment"
          className="min-h-16"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="flex items-center gap-2">
          <Input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            aria-label="Comment author"
            className="h-8 w-28 text-base md:text-sm"
            title="Author recorded in the file — agents use their own name"
          />
          <div className="grow" />
          <Button size="sm" disabled={!text.trim() || add.isPending} onClick={submit}>
            {add.isPending ? <Loader2 className="animate-spin" /> : <MessageSquarePlus />}
            Comment
          </Button>
        </div>
      </div>
    </section>
  )
}
