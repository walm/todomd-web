import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronsUpDown,
  FolderPlus,
  Loader2,
  Pencil,
  Trash2,
} from 'lucide-react'
import type { Project } from '@/api/types'
import { useAddProject, useRemoveProject, useRenameProject } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ResponsiveDialog } from '@/components/responsive-dialog'
import { cn } from '@/lib/utils'

export interface ProjectSwitcherProps {
  projects: Project[]
  current: Project | undefined
  /** Unread count for a project, for the dot next to its name. */
  unreadFor: (id: string) => number
  onSelect: (id: string) => void
  /** Renaming changes the project's id, so the app has to follow it: move the
   *  unread marks across and, if it is the one on screen, the URL too. */
  onRenamed: (from: string, to: string) => void
  /** False when the list came from the command line: no editing the list. */
  configurable: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProjectSwitcher({
  projects,
  current,
  unreadFor,
  onSelect,
  onRenamed,
  configurable,
  open,
  onOpenChange,
}: ProjectSwitcherProps) {
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const remove = useRemoveProject()

  useEffect(() => {
    if (!open) {
      setAdding(false)
      setRenaming(null)
    }
  }, [open])

  // One project and no way to add another: there is nothing to switch to, so
  // the header just says where you are.
  const single = projects.length <= 1 && !configurable

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={cn('-ml-1 gap-1.5 px-1.5 font-semibold', single && 'pointer-events-none')}
        aria-label={single ? undefined : 'Switch project'}
        onClick={() => !single && onOpenChange(true)}
      >
        <span className="max-w-40 truncate sm:max-w-56">
          {current?.name ?? 'No project'}
        </span>
        {!single && <ChevronsUpDown className="opacity-50" />}
      </Button>

      <ResponsiveDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Projects"
        description={configurable ? undefined : 'Given on the command line'}
      >
        <ul className="flex flex-col gap-1 pb-2">
          {projects.map((project) => {
            const unread = unreadFor(project.id)
            const active = project.id === current?.id
            if (renaming === project.id) {
              return (
                <li key={project.id}>
                  <RenameProject
                    project={project}
                    onDone={() => setRenaming(null)}
                    onRenamed={onRenamed}
                  />
                </li>
              )
            }
            return (
              <li key={project.id} className="group/row flex items-center gap-1">
                <button
                  type="button"
                  disabled={!project.available}
                  onClick={() => {
                    onSelect(project.id)
                    onOpenChange(false)
                  }}
                  className={cn(
                    'flex min-w-0 grow items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors',
                    'hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                    active && 'bg-muted',
                    !project.available && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <Check className={cn('size-4 shrink-0', !active && 'opacity-0')} />
                  <span className="min-w-0 grow">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{project.name}</span>
                      {unread > 0 && (
                        <span
                          className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500/15 px-1 text-[0.65rem] font-medium text-emerald-700 tabular-nums dark:text-emerald-300"
                          title={`${unread} unread`}
                        >
                          {unread}
                        </span>
                      )}
                      {!project.available && (
                        <span className="inline-flex items-center gap-1 text-xs text-destructive">
                          <AlertTriangle className="size-3" />
                          missing
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {project.dir}
                    </span>
                  </span>
                </button>
                {configurable && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Rename ${project.name}`}
                    title="Rename this project"
                    className="opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
                    onClick={() => setRenaming(project.id)}
                  >
                    <Pencil />
                  </Button>
                )}
                {configurable && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${project.name} from the list`}
                    title="Remove from this list — the file stays where it is"
                    className="opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(project.id)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            )
          })}
          {projects.length === 0 && (
            <li className="px-2 py-6 text-center text-sm text-muted-foreground">
              No projects yet
            </li>
          )}
        </ul>

        {configurable && (
          <div className="border-t pt-3">
            {adding ? (
              <AddProject onDone={() => setAdding(false)} />
            ) : (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Names default to the folder. Rename with the pencil; removing a
                  project takes it off this list and leaves the file where it is.
                </p>
                <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                  <FolderPlus />
                  Add
                </Button>
              </div>
            )}
          </div>
        )}
      </ResponsiveDialog>
    </>
  )
}

/** Renaming in place. The id follows the name, so the caller is told about
 *  both and can keep the URL and the unread marks pointing at the right
 *  project. */
function RenameProject({
  project,
  onDone,
  onRenamed,
}: {
  project: Project
  onDone: () => void
  onRenamed: (from: string, to: string) => void
}) {
  const [name, setName] = useState(project.name)
  const rename = useRenameProject()

  const submit = () => {
    const next = name.trim()
    if (!next) return
    if (next === project.name) {
      onDone()
      return
    }
    rename.mutate(
      { id: project.id, name: next },
      {
        onSuccess: (updated) => {
          onRenamed(project.id, updated.id)
          onDone()
        },
      },
    )
  }

  return (
    <form
      className="flex items-center gap-1 py-1"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label={`New name for ${project.name}`}
        className="h-8"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onDone()
          }
        }}
      />
      <Button type="submit" size="sm" disabled={!name.trim() || rename.isPending}>
        {rename.isPending && <Loader2 className="animate-spin" />}
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </form>
  )
}

/** The add form: a path, and — if nothing is there yet — an offer to create
 *  one with `todomd init`. */
function AddProject({ onDone }: { onDone: () => void }) {
  const [path, setPath] = useState('')
  const [missing, setMissing] = useState(false)
  const add = useAddProject()

  const submit = (create: boolean) => {
    const file = path.trim()
    if (!file) return
    add.mutate(
      { file, create },
      {
        onSuccess: onDone,
        onError: (err) => setMissing(/does not exist/.test(err.message)),
      },
    )
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit(missing)
      }}
    >
      <Input
        value={path}
        onChange={(e) => {
          setPath(e.target.value)
          setMissing(false)
        }}
        placeholder="~/src/project — or the path to a TODO.md"
        aria-label="Project path"
        autoFocus
      />
      <p className="text-xs text-muted-foreground">
        A directory means the <code>TODO.md</code> inside it.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!path.trim() || add.isPending}>
          {add.isPending && <Loader2 className="animate-spin" />}
          {missing ? 'Create it' : 'Add'}
        </Button>
      </div>
      {missing && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Nothing there yet — "Create it" runs <code>todomd init</code> for you.
        </p>
      )}
    </form>
  )
}
