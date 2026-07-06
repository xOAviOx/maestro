import type { Task, Workflow } from '@shared/types'
import { useStore } from '../../store'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { cn } from '../ui/cn'
import { TASK_STATUS_META } from './dag'

/**
 * Side panel for the selected task: prompt, status, timing, linked workspace,
 * and the review actions valid for its current status. Rejection routes through
 * the parent so it can show the cascade-confirmation dialog first.
 */
export function TaskInspector({
  workflow,
  task,
  onClose,
  onReject
}: {
  workflow: Workflow
  task: Task
  onClose: () => void
  onReject: (task: Task) => void
}): JSX.Element {
  const approveTask = useStore((s) => s.approveTask)
  const retryTask = useStore((s) => s.retryTask)
  const meta = TASK_STATUS_META[task.status]

  const canReview = task.status === 'completed'
  const canRetry = task.status === 'failed'
  const conflict = task.conflict

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-hair bg-surface">
      <div className="flex items-start justify-between gap-2 border-b border-hair px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-content">{task.title}</h3>
          <span className={cn('text-[11px] font-medium uppercase tracking-wide', meta.pill)}>
            {conflict ? `${meta.label} · ${conflict.kind} conflict` : meta.label}
          </span>
        </div>
        <IconButton onClick={onClose} aria-label="Close inspector" title="Close">
          <Icon name="close" />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {conflict && (
          <div className="rounded-lg border border-status-error/40 bg-status-error/10 p-3 text-xs text-content-muted">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-status-error">
              <Icon name="wrench" size={13} />
              {conflict.kind === 'merge' ? 'Merge conflict' : 'Rebase conflict'}
            </div>
            <p>
              Resolve it in the worktree’s terminal
              {conflict.files.length > 0 ? ` (${conflict.files.length} file(s))` : ''}, then approve
              again.
            </p>
            {conflict.message && <p className="mt-1 font-mono text-[11px]">{conflict.message}</p>}
          </div>
        )}

        <Section label="Prompt">
          <p className="whitespace-pre-wrap rounded-lg border border-hair bg-surface-2 p-3 text-xs text-content-muted">
            {task.prompt}
          </p>
        </Section>

        <Section label="Details">
          <dl className="space-y-1.5 text-xs">
            <Row k="Depends on" v={task.dependsOn.length ? task.dependsOn.join(', ') : '—'} />
            <Row k="Workspace" v={task.agentId ?? '—'} mono />
            <Row k="Retries" v={String(task.retryCount)} />
            {task.failureReason && <Row k="Failure" v={task.failureReason} />}
            <Row k="Started" v={fmtTime(task.startedAt)} />
            <Row k="Finished" v={fmtTime(task.finishedAt)} />
            <Row k="Duration" v={fmtDuration(task.startedAt, task.finishedAt)} />
          </dl>
        </Section>
      </div>

      {(canReview || canRetry) && (
        <div className="flex gap-2 border-t border-hair px-4 py-3">
          {canReview && (
            <>
              <Button
                variant="success"
                className="flex-1"
                onClick={() => void approveTask(workflow.id, task.id)}
                title={conflict ? 'Re-run the rebase, then merge' : 'Merge this task into the base'}
              >
                <Icon name="check" />
                {conflict ? 'Resolve & approve' : 'Approve'}
              </Button>
              <Button variant="danger" onClick={() => onReject(task)} title="Reject this task">
                <Icon name="cross" />
                Reject
              </Button>
            </>
          )}
          {canRetry && (
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => void retryTask(workflow.id, task.id)}
            >
              <Icon name="refresh" />
              Retry task
            </Button>
          )}
        </div>
      )}
    </aside>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-content-faint">
        {label}
      </div>
      {children}
    </div>
  )
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }): JSX.Element {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-content-faint">{k}</dt>
      <dd className={cn('min-w-0 truncate text-right text-content-muted', mono && 'font-mono')}>{v}</dd>
    </div>
  )
}

function fmtTime(ms: number | null): string {
  return ms ? new Date(ms).toLocaleTimeString() : '—'
}

function fmtDuration(start: number | null, end: number | null): string {
  if (!start || !end || end < start) return '—'
  const secs = Math.round((end - start) / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  return `${mins}m ${secs % 60}s`
}
