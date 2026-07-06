import dagre from 'dagre'
import type { Edge, Node } from '@xyflow/react'
import type { Task, TaskStatus } from '@shared/types'

/**
 * Shared DAG helpers for the workflow graph view and builder: auto-layout
 * (dagre), cycle detection (for live builder validation), and the status ->
 * color mapping. Kept UI-framework-light so both the read-only run graph and
 * the editable builder derive their nodes/edges the same way.
 */

/** Fixed node box; dagre needs concrete dimensions and React Flow positions by top-left. */
export const NODE_WIDTH = 210
export const NODE_HEIGHT = 68

/** Per-status presentation. Colors follow the spec's legend and the app tokens. */
export interface StatusMeta {
  label: string
  /** Tailwind classes for the node card (border + subtle fill + text). */
  card: string
  /** Tailwind text color for the status pill. */
  pill: string
  /** Running pulses; cancelled is struck through. */
  pulse: boolean
  strike: boolean
}

export const TASK_STATUS_META: Record<TaskStatus, StatusMeta> = {
  blocked: {
    label: 'Blocked',
    card: 'border-hair-strong bg-surface-2 text-content-muted',
    pill: 'text-content-faint',
    pulse: false,
    strike: false
  },
  ready: {
    label: 'Ready',
    card: 'border-status-running/60 bg-status-running/10 text-content',
    pill: 'text-status-running',
    pulse: false,
    strike: false
  },
  running: {
    label: 'Running',
    card: 'border-status-awaiting/70 bg-status-awaiting/10 text-content',
    pill: 'text-status-awaiting',
    pulse: true,
    strike: false
  },
  completed: {
    label: 'Completed',
    card: 'border-accent-violet/70 bg-accent-violet/10 text-content',
    pill: 'text-accent-violet',
    pulse: false,
    strike: false
  },
  merged: {
    label: 'Merged',
    card: 'border-status-done/60 bg-status-done/10 text-content',
    pill: 'text-status-done',
    pulse: false,
    strike: false
  },
  rejected: {
    label: 'Rejected',
    card: 'border-status-error/60 bg-status-error/10 text-content-muted',
    pill: 'text-status-error',
    pulse: false,
    strike: false
  },
  failed: {
    label: 'Failed',
    card: 'border-status-error/60 bg-status-error/10 text-content',
    pill: 'text-status-error',
    pulse: false,
    strike: false
  },
  cancelled: {
    label: 'Cancelled',
    card: 'border-hair bg-surface-2/50 text-content-faint',
    pill: 'text-content-faint',
    pulse: false,
    strike: true
  }
}

/** Data carried on each React Flow node so the custom node can render itself. */
export interface TaskNodeData {
  task: Task
  selected: boolean
  [key: string]: unknown
}

export type TaskFlowNode = Node<TaskNodeData, 'task'>

/** Dependency edges: a parent (dependency) points to the task that depends on it. */
export function taskEdges(tasks: Task[]): Edge[] {
  const ids = new Set(tasks.map((t) => t.id))
  const edges: Edge[] = []
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (!ids.has(dep)) continue
      edges.push({ id: `${dep}->${t.id}`, source: dep, target: t.id })
    }
  }
  return edges
}

/**
 * Top-to-bottom dagre layout for a set of node ids + edges. Returns each node's
 * top-left position (React Flow's origin). Shared by the run graph and the
 * builder so both lay out identically.
 */
export function layoutPositions(
  ids: string[],
  edges: { source: string; target: string }[]
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 48, ranksep: 72, marginx: 24, marginy: 24 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const id of ids) g.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  for (const e of edges) if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target)
  dagre.layout(g)
  const out = new Map<string, { x: number; y: number }>()
  for (const id of ids) {
    const p = g.node(id)
    // dagre centers nodes; React Flow positions by top-left corner.
    out.set(id, { x: (p?.x ?? 0) - NODE_WIDTH / 2, y: (p?.y ?? 0) - NODE_HEIGHT / 2 })
  }
  return out
}

/**
 * Lay tasks out top-to-bottom with dagre and return positioned React Flow
 * nodes + their dependency edges. Pure: same tasks (+ selection) => same layout.
 */
export function layoutTasks(tasks: Task[], selectedId: string | null): {
  nodes: TaskFlowNode[]
  edges: Edge[]
} {
  const edges = taskEdges(tasks)
  const positions = layoutPositions(
    tasks.map((t) => t.id),
    edges
  )
  const nodes: TaskFlowNode[] = tasks.map((t) => ({
    id: t.id,
    type: 'task',
    position: positions.get(t.id) ?? { x: 0, y: 0 },
    data: { task: t, selected: t.id === selectedId }
  }))
  return { nodes, edges }
}

/**
 * Does the directed graph (nodeIds + edges) contain a cycle? Kahn's algorithm:
 * if we can't topologically remove every node, the leftover forms a cycle. Used
 * by the builder to reject an edge that would make the DAG invalid before save.
 */
export function hasCycle(nodeIds: string[], edges: { source: string; target: string }[]): boolean {
  const indegree = new Map<string, number>(nodeIds.map((id) => [id, 0]))
  const adj = new Map<string, string[]>(nodeIds.map((id) => [id, []]))
  for (const e of edges) {
    if (!adj.has(e.source) || !indegree.has(e.target)) continue
    adj.get(e.source)!.push(e.target)
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1)
  }
  const queue = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0)
  let removed = 0
  while (queue.length > 0) {
    const id = queue.shift()!
    removed += 1
    for (const next of adj.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1
      indegree.set(next, d)
      if (d === 0) queue.push(next)
    }
  }
  return removed !== nodeIds.length
}
