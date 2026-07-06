import { Handle, Position, type NodeProps } from '@xyflow/react'
import { cn } from '../ui/cn'
import { Icon } from '../ui/Icon'
import { TASK_STATUS_META, type TaskFlowNode } from './dag'

/**
 * A single DAG task, rendered as a React Flow node. Colored by status per the
 * spec legend; running pulses, cancelled is struck through, and a conflict
 * sub-state shows a warning badge. Handles (top = incoming deps, bottom =
 * outgoing) are what the builder drags between to draw edges.
 */
export function TaskNode({ data }: NodeProps<TaskFlowNode>): JSX.Element {
  const { task, selected } = data
  const meta = TASK_STATUS_META[task.status]
  const conflict = task.conflict

  return (
    <div
      className={cn(
        'relative w-[210px] rounded-xl border px-3 py-2.5 shadow-elev transition-all',
        meta.card,
        selected && 'ring-2 ring-accent/70'
      )}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-hair-strong !bg-surface-3" />

      <div className="flex items-center justify-between gap-2">
        <span className={cn('truncate text-sm font-medium', meta.strike && 'line-through')}>
          {task.title}
        </span>
        {conflict && (
          <span
            className="shrink-0 text-status-error"
            title={`${conflict.kind === 'merge' ? 'Merge' : 'Rebase'} conflict — resolve in the worktree, then approve again`}
          >
            <Icon name="wrench" size={14} />
          </span>
        )}
      </div>

      <div className="mt-1 flex items-center gap-1.5">
        <span
          className={cn(
            'inline-flex h-1.5 w-1.5 rounded-full',
            meta.pill.replace('text-', 'bg-'),
            meta.pulse && 'animate-pulse'
          )}
        />
        <span className={cn('text-[11px] font-medium uppercase tracking-wide', meta.pill)}>
          {conflict ? `${meta.label} · conflict` : meta.label}
        </span>
      </div>

      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-hair-strong !bg-surface-3" />
    </div>
  )
}
