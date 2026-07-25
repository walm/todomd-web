/**
 * The whole router: `/p/{project}` for a board and `/p/{project}/t/{task}` for
 * an open task, so both can be bookmarked or pasted into chat. Task ids are
 * only unique within a file, which is why the project comes first.
 *
 * Links from before projects existed (`/t/{task}`) still resolve — against
 * whichever project the app settles on.
 */
export interface Route {
  project: string | null
  task: string | null
}

const PROJECT_AND_TASK = /^\/p\/([^/]+)(?:\/t\/([0-9a-z]+))?\/?$/
const TASK_ONLY = /^\/t\/([0-9a-z]+)\/?$/

export function readLocation(pathname = window.location.pathname): Route {
  const scoped = PROJECT_AND_TASK.exec(pathname)
  if (scoped) {
    return { project: decodeURIComponent(scoped[1]), task: scoped[2] ?? null }
  }
  const legacy = TASK_ONLY.exec(pathname)
  if (legacy) return { project: null, task: legacy[1] }
  return { project: null, task: null }
}

export function pathFor({ project, task }: Route): string {
  if (!project) return '/'
  const base = `/p/${encodeURIComponent(project)}`
  return task ? `${base}/t/${task}` : base
}

export function writeLocation(route: Route, { replace = false } = {}) {
  const path = pathFor(route)
  if (path === window.location.pathname) return
  if (replace) window.history.replaceState(null, '', path)
  else window.history.pushState(null, '', path)
}
