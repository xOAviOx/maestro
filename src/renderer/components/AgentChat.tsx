import { useEffect, useRef, useState } from 'react'
import { useStore, type ChatItem } from '../store'
import type { AgentEvent, Workspace } from '@shared/types'

function AgentEventView({ event }: { event: AgentEvent }): JSX.Element | null {
  switch (event.kind) {
    case 'session_started':
      return (
        <div className="text-[11px] uppercase tracking-wide text-slate-600">session started</div>
      )
    case 'assistant_text':
      return (
        <div className="max-w-[85%] self-start rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 whitespace-pre-wrap">
          {event.text}
        </div>
      )
    case 'tool_use':
      return (
        <div className="self-start rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-sky-300">
          🔧 {event.name}
          {renderInputHint(event.input)}
        </div>
      )
    case 'tool_result':
      return (
        <div
          className={`self-start rounded-md border px-2 py-1 font-mono text-xs ${
            event.ok
              ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
              : 'border-red-800 bg-red-950/40 text-red-300'
          }`}
        >
          {event.ok ? '✓' : '✗'} {event.name}
          {event.summary ? <span className="ml-1 text-slate-400">— {event.summary}</span> : null}
        </div>
      )
    case 'turn_complete':
      return (
        <div className="text-[11px] uppercase tracking-wide text-slate-600">
          turn complete
          {event.usage?.totalCostUsd !== undefined
            ? ` · $${event.usage.totalCostUsd.toFixed(4)}`
            : ''}
        </div>
      )
    case 'error':
      return (
        <div className="max-w-[85%] self-start rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {event.message}
        </div>
      )
    default:
      return null
  }
}

function renderInputHint(input: unknown): string {
  if (input && typeof input === 'object') {
    const rec = input as Record<string, unknown>
    const fp = rec['file_path'] ?? rec['path'] ?? rec['command'] ?? rec['pattern']
    if (typeof fp === 'string') return ` ${fp.length > 60 ? '…' + fp.slice(-57) : fp}`
  }
  return ''
}

function ChatItemView({ item }: { item: ChatItem }): JSX.Element | null {
  if (item.source === 'user') {
    return (
      <div className="max-w-[85%] self-end rounded-lg bg-status-running px-3 py-2 text-sm text-white whitespace-pre-wrap">
        {item.text}
      </div>
    )
  }
  return <AgentEventView event={item.event} />
}

/** Chat-style transcript + prompt input for one workspace. */
export function AgentChat({ workspace }: { workspace: Workspace }): JSX.Element {
  const items = useStore((s) => s.chats[workspace.id]) ?? []
  const sendPrompt = useStore((s) => s.sendPrompt)
  const cancelAgent = useStore((s) => s.cancelAgent)

  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const running = workspace.status === 'running'

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [items.length])

  const send = (): void => {
    const text = draft.trim()
    if (text.length === 0 || running) return
    setDraft('')
    void sendPrompt(workspace.id, text)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
        {items.length === 0 ? (
          <p className="m-auto text-sm text-slate-500">
            Send a task to start the agent in this workspace.
          </p>
        ) : (
          items.map((item) => <ChatItemView key={item.id} item={item} />)
        )}
      </div>

      <div className="border-t border-slate-800 p-3">
        <div className="flex items-end gap-2">
          <textarea
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
            placeholder={running ? 'Agent is working…' : 'Describe a task or follow-up…'}
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          {running ? (
            <button
              className="rounded-md border border-red-700 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-950/40"
              onClick={() => void cancelAgent(workspace.id)}
            >
              Cancel
            </button>
          ) : (
            <button
              className="rounded-md bg-status-running px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              onClick={send}
              disabled={draft.trim().length === 0}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
