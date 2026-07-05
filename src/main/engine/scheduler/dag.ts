import type { Task } from '@shared/types'

/**
 * Pure, I/O-free graph functions over a workflow's tasks.
 *
 * Everything here is deterministic and side-effect-free so it can be unit-tested
 * without a database, a git repo, or an agent. `WorkflowScheduler` composes these
 * with persistence + the task runner to drive the DAG.
 */

/** The subset of a Task these functions actually read. */
export type GraphTask = Pick<Task, 'id' | 'dependsOn' | 'status' | 'createdAt'>

/** Reverse adjacency: task id -> ids of tasks that directly depend on it. */
function buildChildren(tasks: GraphTask[]): Map<string, string[]> {
  const ids = new Set(tasks.map((t) => t.id))
  const children = new Map<string, string[]>()
  for (const t of tasks) children.set(t.id, [])
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (!ids.has(dep)) continue // dangling edge — reported by findMissingDependencies
      const list = children.get(dep)
      if (list) list.push(t.id)
    }
  }
  return children
}

/**
 * Detect a dependency cycle via Kahn's algorithm (topological sort). Returns the
 * ids of every task that could NOT be topologically ordered — i.e. the tasks
 * on/behind a cycle — or an empty array when the graph is acyclic. Dangling
 * dependency edges are ignored here (validate them with findMissingDependencies).
 */
export function detectCycle(tasks: GraphTask[]): string[] {
  const ids = new Set(tasks.map((t) => t.id))
  const indegree = new Map<string, number>()
  for (const t of tasks) indegree.set(t.id, 0)
  for (const t of tasks) {
    let deg = 0
    for (const dep of t.dependsOn) if (ids.has(dep)) deg++
    indegree.set(t.id, deg)
  }

  const children = buildChildren(tasks)
  const queue: string[] = []
  for (const [id, deg] of indegree) if (deg === 0) queue.push(id)

  let processed = 0
  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined) break
    processed++
    for (const child of children.get(id) ?? []) {
      const next = (indegree.get(child) ?? 0) - 1
      indegree.set(child, next)
      if (next === 0) queue.push(child)
    }
  }

  if (processed === tasks.length) return []
  // Remaining tasks still have a positive indegree => they sit on/after a cycle.
  const stuck: string[] = []
  for (const [id, deg] of indegree) if (deg > 0) stuck.push(id)
  return stuck
}

/**
 * Dependency edges that point at a task id which doesn't exist in the workflow.
 * (A workflow with dangling edges is rejected on save.)
 */
export function findMissingDependencies(
  tasks: GraphTask[]
): Array<{ taskId: string; missing: string[] }> {
  const ids = new Set(tasks.map((t) => t.id))
  const out: Array<{ taskId: string; missing: string[] }> = []
  for (const t of tasks) {
    const missing = t.dependsOn.filter((dep) => !ids.has(dep))
    if (missing.length > 0) out.push({ taskId: t.id, missing })
  }
  return out
}

/**
 * Ids of tasks that are `blocked` but whose dependencies are ALL `merged` — i.e.
 * the ones ready to be promoted to `ready`. A task with no dependencies is
 * vacuously ready. This is the heart of "deps satisfied only when parents are
 * merged, not merely completed".
 */
export function computeReady(tasks: GraphTask[]): string[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const out: string[] = []
  for (const t of tasks) {
    if (t.status !== 'blocked') continue
    const allMerged = t.dependsOn.every((dep) => byId.get(dep)?.status === 'merged')
    if (allMerged) out.push(t.id)
  }
  return out
}

/**
 * All transitive descendants of a task (its children, their children, …). Used
 * to compute the rejection cascade set. Excludes the task itself; robust against
 * cycles via a visited set.
 */
export function descendants(tasks: GraphTask[], taskId: string): string[] {
  const children = buildChildren(tasks)
  const seen = new Set<string>()
  const stack = [...(children.get(taskId) ?? [])]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (cur === undefined || seen.has(cur)) continue
    seen.add(cur)
    for (const c of children.get(cur) ?? []) stack.push(c)
  }
  return [...seen]
}

/**
 * Ids of `ready` tasks in FIFO order (oldest `createdAt` first). `Array.sort` is
 * stable, so tasks sharing a `createdAt` keep their input (insertion) order —
 * the store returns tasks in insertion order, so ties break deterministically.
 */
export function fifoReadyOrder(tasks: GraphTask[]): string[] {
  return tasks
    .filter((t) => t.status === 'ready')
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((t) => t.id)
}
