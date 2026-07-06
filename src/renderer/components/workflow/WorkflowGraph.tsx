import { useMemo } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type NodeMouseHandler
} from '@xyflow/react'
import type { Workflow } from '@shared/types'
import { TaskNode } from './TaskNode'
import { layoutTasks, type TaskFlowNode } from './dag'

const NODE_TYPES = { task: TaskNode }

/**
 * Read-only DAG render of a running/finished workflow. Layout is derived from
 * the tasks every render (dagre) — the scheduler owns all state, so the graph
 * has nothing to persist. Clicking a node selects it for the inspector.
 */
export function WorkflowGraph({
  workflow,
  selectedTaskId,
  onSelectTask
}: {
  workflow: Workflow
  selectedTaskId: string | null
  onSelectTask: (taskId: string | null) => void
}): JSX.Element {
  const { nodes, edges } = useMemo(
    () => layoutTasks(workflow.tasks, selectedTaskId),
    [workflow.tasks, selectedTaskId]
  )

  const onNodeClick: NodeMouseHandler<TaskFlowNode> = (_e, node) => onSelectTask(node.id)

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodeClick={onNodeClick}
      onPaneClick={() => onSelectTask(null)}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      proOptions={{ hideAttribution: true }}
      className="bg-bg"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#23272f" />
      <Controls showInteractive={false} className="!border-hair-strong" />
    </ReactFlow>
  )
}
