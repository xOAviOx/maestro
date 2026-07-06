import { useState } from 'react'
import type { Task, Workflow } from '@shared/types'
import { useStore } from '../../store'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Textarea, FieldLabel } from '../ui/Field'
import { Icon } from '../ui/Icon'

/**
 * Confirms a task rejection. A plain reject cascades: the task plus every
 * transitive descendant (listed here, resolved via `previewCascade`) is
 * cancelled. "Reject & retry" instead re-queues the same task with an optional
 * edited prompt and cancels nothing.
 */
export function CascadeDialog({
  workflow,
  task,
  cascade,
  onClose
}: {
  workflow: Workflow
  task: Task
  /** Ids of descendants that a cascade reject would cancel (from previewCascade). */
  cascade: string[]
  onClose: () => void
}): JSX.Element {
  const rejectTask = useStore((s) => s.rejectTask)
  const [prompt, setPrompt] = useState(task.prompt)

  const titleFor = (id: string): string => workflow.tasks.find((t) => t.id === id)?.title ?? id

  const doReject = (mode: 'cascade' | 'retry'): void => {
    void rejectTask(workflow.id, task.id, mode, mode === 'retry' ? prompt : undefined)
    onClose()
  }

  return (
    <Modal onClose={onClose} title={`Reject “${task.title}”`} size="lg">
      <div className="space-y-4">
        {cascade.length > 0 ? (
          <div className="rounded-lg border border-status-error/40 bg-status-error/10 p-3">
            <p className="mb-2 text-sm text-content-muted">
              Rejecting this task will also <span className="text-status-error">cancel</span> its{' '}
              {cascade.length} downstream task{cascade.length === 1 ? '' : 's'}:
            </p>
            <ul className="space-y-1 text-sm text-content">
              {cascade.map((id) => (
                <li key={id} className="flex items-center gap-1.5">
                  <span className="text-status-error">
                    <Icon name="cross" size={13} />
                  </span>
                  {titleFor(id)}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-content-muted">
            This task has no downstream dependents, so nothing else will be cancelled.
          </p>
        )}

        <div>
          <FieldLabel>Retry prompt (used only by “Reject &amp; retry”)</FieldLabel>
          <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>

        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => doReject('retry')} disabled={!prompt.trim()}>
              <Icon name="refresh" />
              Reject &amp; retry
            </Button>
            <Button variant="danger" onClick={() => doReject('cascade')}>
              <Icon name="cross" />
              {cascade.length > 0 ? `Reject & cancel ${cascade.length}` : 'Reject'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
