import type { WorkspaceStatus } from '@shared/types'

const STATUS_META: Record<WorkspaceStatus, { color: string; label: string; pulse: boolean }> = {
  idle: { color: 'bg-status-idle', label: 'Idle', pulse: false },
  running: { color: 'bg-status-running', label: 'Running', pulse: true },
  awaiting_input: { color: 'bg-status-awaiting', label: 'Awaiting input', pulse: false },
  done: { color: 'bg-status-done', label: 'Done', pulse: false },
  error: { color: 'bg-status-error', label: 'Error', pulse: false }
}

export function statusLabel(status: WorkspaceStatus): string {
  return STATUS_META[status].label
}

export function StatusDot({ status }: { status: WorkspaceStatus }): JSX.Element {
  const meta = STATUS_META[status]
  return (
    <span className="relative inline-flex h-2.5 w-2.5" title={meta.label}>
      {meta.pulse && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${meta.color}`}
        />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${meta.color}`} />
    </span>
  )
}
