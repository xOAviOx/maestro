import { useCallback, useMemo, useState } from 'react'
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps
} from '@xyflow/react'
import { useStore } from '../../store'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { Input, Textarea, Select, FieldLabel } from '../ui/Field'
import { cn } from '../ui/cn'
import { hasCycle, layoutPositions } from './dag'
import { WORKFLOW_TEMPLATES } from './templates'

/** Editable builder node: just a titled card with connect handles. */
type BuilderData = { title: string; prompt: string; [key: string]: unknown }
type BuilderNodeType = Node<BuilderData, 'builder'>

function BuilderNode({ data, selected }: NodeProps<BuilderNodeType>): JSX.Element {
  return (
    <div
      className={cn(
        'w-[210px] rounded-xl border border-hair-strong bg-surface-2 px-3 py-2.5 text-sm text-content shadow-elev transition-all',
        selected && 'ring-2 ring-accent/70'
      )}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-hair-strong !bg-surface-3" />
      <span className="block truncate font-medium">{data.title || 'Untitled task'}</span>
      <span className="mt-0.5 block truncate text-[11px] text-content-faint">
        {data.prompt ? data.prompt : 'No prompt yet'}
      </span>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-hair-strong !bg-surface-3" />
    </div>
  )
}

const NODE_TYPES = { builder: BuilderNode }

/**
 * Full-screen draft editor. The scheduler has no "add task to existing
 * workflow" API — a workflow is created whole — so the builder constructs the
 * task set + dependency edges client-side (with live cycle rejection) and calls
 * createWorkflow once. On success it hands off to the run view.
 */
export function WorkflowBuilder({ onClose }: { onClose: () => void }): JSX.Element {
  const activeRepoPath = useStore((s) => s.activeRepoPath)
  const repoInfo = useStore((s) => s.repoInfo)
  const createWorkflow = useStore((s) => s.createWorkflow)
  const pushToast = useStore((s) => s.pushToast)
  const loading = useStore((s) => s.loading)

  const [name, setName] = useState('')
  const [baseBranch, setBaseBranch] = useState('')
  const [maxConcurrency, setMaxConcurrency] = useState(3)
  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNodeType>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [seq, setSeq] = useState(0)

  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId])

  const addTask = useCallback(() => {
    const id = `task-${seq + 1}`
    setSeq((n) => n + 1)
    setNodes((ns) => [
      ...ns,
      {
        id,
        type: 'builder',
        position: { x: 80 + (ns.length % 3) * 60, y: 80 + ns.length * 40 },
        data: { title: `Task ${seq + 1}`, prompt: '' }
      }
    ])
    setSelectedId(id)
  }, [seq, setNodes])

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return
      const candidate = [...edges, { source: conn.source, target: conn.target }]
      if (hasCycle(nodes.map((n) => n.id), candidate)) {
        pushToast('error', 'That dependency would create a cycle.')
        return
      }
      setEdges((es) => addEdge({ ...conn, id: `${conn.source}->${conn.target}` }, es))
    },
    [edges, nodes, pushToast, setEdges]
  )

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    setNodes((ns) => ns.filter((n) => n.id !== selectedId))
    setEdges((es) => es.filter((e) => e.source !== selectedId && e.target !== selectedId))
    setSelectedId(null)
  }, [selectedId, setNodes, setEdges])

  const patchSelected = useCallback(
    (patch: Partial<BuilderData>) => {
      if (!selectedId) return
      setNodes((ns) =>
        ns.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n))
      )
    },
    [selectedId, setNodes]
  )

  const loadTemplate = useCallback(
    (key: string) => {
      const tmpl = WORKFLOW_TEMPLATES.find((t) => t.key === key)
      if (!tmpl) return
      const tEdges: Edge[] = tmpl.tasks.flatMap((t) =>
        (t.dependsOn ?? []).map((dep) => ({ id: `${dep}->${t.id}`, source: dep, target: t.id }))
      )
      const positions = layoutPositions(
        tmpl.tasks.map((t) => t.id),
        tEdges
      )
      setNodes(
        tmpl.tasks.map((t) => ({
          id: t.id,
          type: 'builder' as const,
          position: positions.get(t.id) ?? { x: 0, y: 0 },
          data: { title: t.title, prompt: t.prompt }
        }))
      )
      setEdges(tEdges)
      setSelectedId(null)
      if (!name.trim()) setName(tmpl.name)
      pushToast('info', `Loaded “${tmpl.name}” template.`)
    },
    [name, pushToast, setEdges, setNodes]
  )

  const create = useCallback(async () => {
    if (!activeRepoPath) {
      pushToast('error', 'Open a repo before creating a workflow.')
      return
    }
    if (!name.trim()) {
      pushToast('error', 'Give the workflow a name.')
      return
    }
    if (nodes.length === 0) {
      pushToast('error', 'Add at least one task.')
      return
    }
    const missing = nodes.find((n) => !n.data.title.trim() || !n.data.prompt.trim())
    if (missing) {
      pushToast('error', 'Every task needs a title and a prompt.')
      setSelectedId(missing.id)
      return
    }
    const tasks = nodes.map((n) => ({
      id: n.id,
      title: n.data.title.trim(),
      prompt: n.data.prompt.trim(),
      dependsOn: edges.filter((e) => e.target === n.id).map((e) => e.source)
    }))
    const wf = await createWorkflow({
      name: name.trim(),
      repoPath: activeRepoPath,
      ...(baseBranch.trim() ? { baseBranch: baseBranch.trim() } : {}),
      maxConcurrency,
      tasks
    })
    if (wf) onClose()
  }, [activeRepoPath, baseBranch, createWorkflow, edges, maxConcurrency, name, nodes, onClose, pushToast])

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg animate-fade-in">
      {/* Header */}
      <div className="app-drag flex items-center justify-between gap-3 border-b border-hair px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-content">
          <Icon name="fanout" size={16} />
          New workflow
        </div>
        <div className="no-drag flex items-center gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void create()} disabled={loading}>
            <Icon name="check" />
            Create workflow
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left rail: workflow meta + task editor */}
        <div className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-r border-hair bg-surface p-4">
          <div>
            <FieldLabel>Workflow name</FieldLabel>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Auth refactor" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <FieldLabel>Base branch</FieldLabel>
              <Input
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                placeholder={repoInfo?.defaultBaseBranch ?? 'default'}
              />
            </div>
            <div>
              <FieldLabel>Max concurrency</FieldLabel>
              <Input
                type="number"
                min={1}
                value={maxConcurrency}
                onChange={(e) => setMaxConcurrency(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
          </div>
          <div>
            <FieldLabel>Start from template</FieldLabel>
            <Select defaultValue="" onChange={(e) => e.target.value && loadTemplate(e.target.value)}>
              <option value="">Blank</option>
              {WORKFLOW_TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="border-t border-hair pt-3">
            {selected ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-content-faint">
                    Edit task
                  </span>
                  <IconButton onClick={deleteSelected} aria-label="Delete task" title="Delete task">
                    <Icon name="archive" />
                  </IconButton>
                </div>
                <div>
                  <FieldLabel>Title</FieldLabel>
                  <Input
                    value={selected.data.title}
                    onChange={(e) => patchSelected({ title: e.target.value })}
                  />
                </div>
                <div>
                  <FieldLabel>Prompt</FieldLabel>
                  <Textarea
                    rows={6}
                    value={selected.data.prompt}
                    onChange={(e) => patchSelected({ prompt: e.target.value })}
                    placeholder="What should the agent do for this task?"
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-content-faint">
                Select a task to edit it, or add one. Drag from a node’s bottom handle to another
                node’s top handle to add a dependency.
              </p>
            )}
          </div>
        </div>

        {/* Canvas */}
        <div className="relative min-w-0 flex-1">
          <div className="absolute left-3 top-3 z-10">
            <Button variant="secondary" onClick={addTask}>
              <Icon name="plus" />
              Add task
            </Button>
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={({ nodes: sel }) => setSelectedId(sel[0]?.id ?? null)}
            defaultViewport={{ x: 0, y: 0, zoom: 1 }}
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
            className="bg-bg"
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#23272f" />
            <Controls showInteractive={false} className="!border-hair-strong" />
          </ReactFlow>
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-content-faint">
                Add tasks and connect them to build your DAG.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
