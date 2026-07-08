import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore, type ChatItem } from '../store'
import type { AgentEvent, Workspace } from '@shared/types'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'
import { Textarea, Select } from './ui/Field'
import { cn } from './ui/cn'

function AgentEventView({
  event,
  workspaceId
}: {
  event: AgentEvent
  workspaceId: string
}): JSX.Element | null {
  switch (event.kind) {
    case 'permission_request':
      return (
        <PermissionRequestView
          workspaceId={workspaceId}
          requestId={event.requestId}
          toolName={event.toolName}
          input={event.input}
        />
      )
    case 'permission_resolved':
      // Settled in the store (freezes the request bubble); nothing to render here.
      return null
    case 'session_started':
      return (
        <div className="text-[11px] uppercase tracking-wide text-content-faint">session started</div>
      )
    case 'assistant_text':
      return (
        <div className="max-w-[85%] self-start rounded-2xl rounded-tl-sm bg-surface-2 px-3 py-2 text-sm text-content whitespace-pre-wrap">
          {event.text}
        </div>
      )
    case 'tool_use':
      return (
        <div className="flex items-center gap-1.5 self-start rounded-lg border border-hair bg-surface px-2 py-1 font-mono text-xs text-accent">
          <Icon name="wrench" size={13} />
          {event.name}
          {renderInputHint(event.input)}
        </div>
      )
    case 'tool_result':
      return (
        <div
          className={cn(
            'flex items-center gap-1.5 self-start rounded-lg border px-2 py-1 font-mono text-xs',
            event.ok
              ? 'border-status-done/40 bg-status-done/10 text-status-done'
              : 'border-status-error/40 bg-status-error/10 text-status-error'
          )}
        >
          <Icon name={event.ok ? 'check' : 'cross'} size={13} />
          {event.name}
          {event.summary ? <span className="ml-1 text-content-muted">— {event.summary}</span> : null}
        </div>
      )
    case 'turn_complete':
      return (
        <div className="text-[11px] uppercase tracking-wide text-content-faint">
          turn complete
          {event.usage?.totalCostUsd !== undefined
            ? ` · $${event.usage.totalCostUsd.toFixed(4)}`
            : ''}
        </div>
      )
    case 'error':
      return (
        <div className="max-w-[85%] self-start rounded-2xl border border-status-error/40 bg-status-error/10 px-3 py-2 text-sm text-status-error">
          {event.message}
        </div>
      )
    default:
      return null
  }
}

/** A paused gated tool call (writes / shell) with live Approve / Reject. Once
 * answered — by the user, or by the run ending — the buttons freeze into the
 * outcome so the transcript stays a faithful record. */
function PermissionRequestView({
  workspaceId,
  requestId,
  toolName,
  input
}: {
  workspaceId: string
  requestId: string
  toolName: string
  input: unknown
}): JSX.Element {
  const resolution = useStore((s) => s.permissionResolutions[requestId])
  const respond = useStore((s) => s.respondPermission)
  const hint = renderInputHint(input)

  return (
    <div className="max-w-[85%] self-start rounded-lg border border-status-awaiting/40 bg-status-awaiting/10 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-content">
        <Icon name="wrench" size={13} />
        <span>
          Run <span className="font-semibold text-accent">{toolName}</span>?
        </span>
        {hint ? <span className="text-content-muted">{hint}</span> : null}
      </div>
      {resolution ? (
        <div
          className={cn(
            'mt-1.5 flex items-center gap-1 text-xs font-medium',
            resolution === 'approved' ? 'text-status-done' : 'text-status-error'
          )}
        >
          <Icon name={resolution === 'approved' ? 'check' : 'close'} size={12} />
          {resolution === 'approved'
            ? 'Approved'
            : resolution === 'rejected'
              ? 'Rejected'
              : 'Expired — run ended before you answered'}
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            variant="success"
            onClick={() => void respond(workspaceId, requestId, true)}
          >
            <Icon name="check" size={13} />
            Approve
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => void respond(workspaceId, requestId, false)}
          >
            <Icon name="close" size={13} />
            Reject
          </Button>
        </div>
      )}
    </div>
  )
}

function renderInputHint(input: unknown): string {
  if (input && typeof input === 'object') {
    const rec = input as Record<string, unknown>
    const fp = rec['file_path'] ?? rec['path'] ?? rec['command'] ?? rec['pattern']
    if (typeof fp === 'string') return ` ${fp.length > 60 ? '…' + fp.slice(-57) : fp}`
  }
  return ''
}

function ChatItemView({
  item,
  workspaceId
}: {
  item: ChatItem
  workspaceId: string
}): JSX.Element | null {
  if (item.source === 'user') {
    return (
      <div className="max-w-[85%] self-end rounded-2xl rounded-tr-sm bg-accent px-3 py-2 text-sm font-medium text-bg whitespace-pre-wrap">
        {item.text}
      </div>
    )
  }
  return <AgentEventView event={item.event} workspaceId={workspaceId} />
}

/** Chat-style transcript + prompt input for one workspace. */
export function AgentChat({ workspace }: { workspace: Workspace }): JSX.Element {
  const items = useStore((s) => s.chats[workspace.id]) ?? []
  const sendPrompt = useStore((s) => s.sendPrompt)
  const cancelAgent = useStore((s) => s.cancelAgent)
  const enqueueJob = useStore((s) => s.enqueueJob)
  const cancelJob = useStore((s) => s.cancelJob)
  const queue = useStore((s) => s.queue)
  const siblings = useStore(
    useShallow((s) => s.workspaces.filter((w) => w.id !== workspace.id))
  )

  const [draft, setDraft] = useState('')
  const [dependsOn, setDependsOn] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const running = workspace.status === 'running'
  const myJobs = queue.filter((j) => j.workspaceId === workspace.id)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [items.length])

  const send = (): void => {
    const text = draft.trim()
    if (text.length === 0 || running) return
    setDraft('')
    void sendPrompt(workspace.id, text)
  }

  const queueIt = (): void => {
    const text = draft.trim()
    if (text.length === 0) return
    setDraft('')
    void enqueueJob(workspace.id, text, dependsOn || undefined)
  }

  const wsName = (id: string): string => siblings.find((w) => w.id === id)?.name ?? id.slice(0, 8)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
        {items.length === 0 ? (
          <div className="m-auto flex flex-col items-center gap-2 text-center">
            <span className="text-content-faint">
              <Icon name="chat" size={30} />
            </span>
            <p className="text-sm text-content-muted">
              Send a task to start the agent in this workspace.
            </p>
          </div>
        ) : (
          items.map((item) => (
            <ChatItemView key={item.id} item={item} workspaceId={workspace.id} />
          ))
        )}
      </div>

      <div className="border-t border-hair bg-surface/40 p-3">
        {/* Pending queued jobs for this workspace. */}
        {myJobs.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {myJobs.map((j) => (
              <span
                key={j.id}
                className="flex items-center gap-1 rounded-full border border-hair bg-surface-2 px-2 py-0.5 text-xs text-content-muted"
                title={j.prompt}
              >
                <span className="text-content-faint">queued</span>
                {j.dependsOnWorkspaceId && (
                  <span className="text-status-awaiting">after {wsName(j.dependsOnWorkspaceId)}</span>
                )}
                <span className="max-w-[160px] truncate">{j.prompt}</span>
                <button
                  className="text-content-faint hover:text-content"
                  onClick={() => void cancelJob(j.id)}
                  title="Remove from queue"
                >
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <Textarea
            className="max-h-40 min-h-[44px] flex-1"
            placeholder={
              running ? 'Agent is working — queue a follow-up…' : 'Describe a task or follow-up…'
            }
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (running) queueIt()
                else send()
              }
            }}
          />
          <div className="flex flex-col items-stretch gap-1">
            {siblings.length > 0 && (
              <Select
                className="py-1 text-xs"
                value={dependsOn}
                onChange={(e) => setDependsOn(e.target.value)}
                title="Optionally wait for another workspace to finish first"
              >
                <option value="">run when free</option>
                {siblings.map((w) => (
                  <option key={w.id} value={w.id}>
                    after: {w.name}
                  </option>
                ))}
              </Select>
            )}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={queueIt}
                disabled={draft.trim().length === 0}
                title="Add to the queue; runs when this workspace is free"
              >
                <Icon name="queue" />
                Queue
              </Button>
              {running ? (
                <Button variant="danger" onClick={() => void cancelAgent(workspace.id)}>
                  <Icon name="close" />
                  Cancel
                </Button>
              ) : (
                <Button variant="primary" onClick={send} disabled={draft.trim().length === 0}>
                  <Icon name="send" />
                  Send
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
