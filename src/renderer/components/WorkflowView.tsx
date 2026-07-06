import { useEffect, useState } from 'react'
import type { Task, WorkflowStatus } from '@shared/types'
import { useStore } from '../store'
import { ipc } from '../ipc'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'
import { cn } from './ui/cn'
import { WorkflowGraph } from './workflow/WorkflowGraph'
import { TaskInspector } from './workflow/TaskInspector'
import { CascadeDialog } from './workflow/CascadeDialog'

const WF_STATUS_META: Record<WorkflowStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'text-content-faint' },
  running: { label: 'Running', cls: 'text-status-running' },
  paused: { label: 'Paused', cls: 'text-status-awaiting' },
  completed: { label: 'Completed', cls: 'text-status-done' },
  failed: { label: 'Failed', cls: 'text-status-error' }
}

/**
 * Main panel for the workflows view: run controls, the DAG graph, and the
 * selected-task inspector. Rejection opens the cascade-confirmation dialog
 * (descendants resolved via previewCascade) before anything is cancelled.
 */
export function WorkflowView(): JSX.Element {
  const workflows = useStore((s) => s.workflows)
  const selectedWorkflowId = useStore((s) => s.selectedWorkflowId)
  const startWorkflow = useStore((s) => s.startWorkflow)
  const pauseWorkflow = useStore((s) => s.pauseWorkflow)
  const resumeWorkflow = useStore((s) => s.resumeWorkflow)
  const setActiveDialog = useStore((s) => s.setActiveDialog)

  const workflow = workflows.find((w) => w.id === selectedWorkflowId) ?? null

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [cascadeFor, setCascadeFor] = useState<{ task: Task; ids: string[] } | null>(null)

  // Reset the selection when the workflow changes.
  useEffect(() => setSelectedTaskId(null), [selectedWorkflowId])

  if (!workflow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <span className="text-content-faint">
          <Icon name="graph" size={32} />
        </span>
        <p className="text-sm text-content-faint">
          No workflows yet. Create one to orchestrate a task DAG.
        </p>
        <Button variant="primary" onClick={() => setActiveDialog('workflow-builder')}>
          <Icon name="plus" />
          New workflow
        </Button>
      </div>
    )
  }

  const status = WF_STATUS_META[workflow.status]
  const selectedTask = workflow.tasks.find((t) => t.id === selectedTaskId) ?? null

  const openReject = async (task: Task): Promise<void> => {
    // Resolve the exact descendant set the scheduler would cancel, so the
    // confirmation dialog can list them precisely.
    let ids: string[] = []
    try {
      ids = await ipc.previewCascade(workflow.id, task.id)
    } catch {
      ids = []
    }
    setCascadeFor({ task, ids })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-hair px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-content">{workflow.name}</h2>
            <span className={cn('text-[11px] font-medium uppercase tracking-wide', status.cls)}>
              {status.label}
            </span>
          </div>
          <p className="truncate font-mono text-xs text-content-faint">
            {workflow.baseBranch} · {workflow.tasks.length} tasks · max {workflow.maxConcurrency}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {workflow.status === 'draft' && (
            <Button variant="primary" onClick={() => void startWorkflow(workflow.id)}>
              <Icon name="play" />
              Start
            </Button>
          )}
          {workflow.status === 'running' && (
            <Button variant="secondary" onClick={() => void pauseWorkflow(workflow.id)}>
              <Icon name="pause" />
              Pause
            </Button>
          )}
          {workflow.status === 'paused' && (
            <Button variant="primary" onClick={() => void resumeWorkflow(workflow.id)}>
              <Icon name="play" />
              Resume
            </Button>
          )}
        </div>
      </div>

      {/* Graph + inspector */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <WorkflowGraph
            workflow={workflow}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
          />
        </div>
        {selectedTask && (
          <TaskInspector
            workflow={workflow}
            task={selectedTask}
            onClose={() => setSelectedTaskId(null)}
            onReject={(task) => void openReject(task)}
          />
        )}
      </div>

      {cascadeFor && (
        <CascadeDialog
          workflow={workflow}
          task={cascadeFor.task}
          cascade={cascadeFor.ids}
          onClose={() => setCascadeFor(null)}
        />
      )}
    </div>
  )
}
