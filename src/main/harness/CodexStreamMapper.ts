import type { AgentEvent, TokenUsage } from '@shared/types'

/**
 * Maps the Codex CLI's `exec --json` thread-event stream (NDJSON) onto the
 * normalized AgentEvent union — the Codex analog of ClaudeStreamMapper.
 *
 * Stateful per run: remembers the thread id from `thread.started` (so the
 * `turn.completed` event, which omits it, can still carry a sessionId) and the
 * set of item ids it has already opened as a tool_use (so completed-only items
 * still emit a matching tool_use/tool_result pair).
 *
 * Defensive by design: unparseable or unrecognized lines yield no events (they
 * are ignored, never thrown). Built against the documented thread-event format
 * (Codex `exec --json`):
 *   thread.started                  -> session_started (carries thread_id)
 *   turn.started                    -> ignored
 *   item.started (tool-like)        -> tool_use
 *   item.completed agent_message    -> assistant_text
 *   item.completed (tool-like)      -> tool_use (if not already) + tool_result
 *   item.completed reasoning        -> ignored (no thinking kind in the union)
 *   item.updated                    -> ignored (streaming progress noise)
 *   turn.completed                  -> turn_complete (carries usage)
 *   turn.failed                     -> error (error.message)
 *   error (transient reconnect)     -> ignored (non-fatal progress)
 *
 * Field-naming defenses (versions differ): the item discriminator is read from
 * either `item.type` or `item.item_type`, and an assistant message may be typed
 * `agent_message` or `assistant_message`.
 */
export class CodexStreamMapper {
  private threadId = ''
  private readonly openedToolIds = new Set<string>()

  mapLine(line: string): AgentEvent[] {
    const trimmed = line.trim()
    if (trimmed.length === 0) return []
    let obj: unknown
    try {
      obj = JSON.parse(trimmed)
    } catch {
      return [] // not JSON (e.g. a stray log line) — ignore
    }
    return this.mapObject(obj)
  }

  private mapObject(obj: unknown): AgentEvent[] {
    if (!isRecord(obj)) return []
    switch (obj['type']) {
      case 'thread.started': {
        const id = typeof obj['thread_id'] === 'string' ? obj['thread_id'] : ''
        if (id) this.threadId = id
        return id ? [{ kind: 'session_started', sessionId: id }] : []
      }
      case 'item.started':
        return this.mapItem(obj['item'], 'started')
      case 'item.completed':
        return this.mapItem(obj['item'], 'completed')
      case 'item.updated':
        return [] // streaming progress — ignored to avoid transcript noise
      case 'turn.completed':
        return [this.turnComplete(obj)]
      case 'turn.failed':
        return [{ kind: 'error', message: failureMessage(obj) }]
      case 'error':
        // Transient reconnect notices ("Reconnecting... 1/5"); the turn continues.
        return []
      default:
        return []
    }
  }

  private mapItem(item: unknown, phase: 'started' | 'completed'): AgentEvent[] {
    if (!isRecord(item)) return []
    const itemType = itemTypeOf(item)
    const id = typeof item['id'] === 'string' ? item['id'] : ''

    if (itemType === 'agent_message' || itemType === 'assistant_message') {
      if (phase !== 'completed') return []
      const text = typeof item['text'] === 'string' ? item['text'] : ''
      return text.trim().length > 0 ? [{ kind: 'assistant_text', text }] : []
    }

    if (itemType === 'reasoning') return [] // no thinking kind in the union

    // Everything else is treated as a tool: command_execution, file_change,
    // mcp_tool_call, web_search, and any future/unknown tool-like item.
    const name = toolName(itemType)
    if (phase === 'started') {
      if (id) this.openedToolIds.add(id)
      return [{ kind: 'tool_use', name, input: toolInput(item) }]
    }

    // completed: emit the opening tool_use first if we never saw item.started
    // for this id (file_change / web_search arrive only as item.completed).
    const events: AgentEvent[] = []
    if (!id || !this.openedToolIds.has(id)) {
      events.push({ kind: 'tool_use', name, input: toolInput(item) })
    }
    if (id) this.openedToolIds.delete(id)
    const ok = isItemOk(item)
    const summary = summarizeItem(itemType, item)
    events.push(summary ? { kind: 'tool_result', name, ok, summary } : { kind: 'tool_result', name, ok })
    return events
  }

  private turnComplete(obj: Record<string, unknown>): AgentEvent {
    const usage = mapUsage(obj['usage'])
    return usage
      ? { kind: 'turn_complete', sessionId: this.threadId, usage }
      : { kind: 'turn_complete', sessionId: this.threadId }
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** Read the item discriminator from `type` or legacy `item_type`. */
function itemTypeOf(item: Record<string, unknown>): string {
  if (typeof item['type'] === 'string') return item['type']
  if (typeof item['item_type'] === 'string') return item['item_type']
  return ''
}

/** A short, stable tool label for the normalized stream. */
function toolName(itemType: string): string {
  switch (itemType) {
    case 'command_execution':
      return 'command'
    case 'file_change':
      return 'file_change'
    case 'mcp_tool_call':
      return 'mcp_tool'
    case 'web_search':
      return 'web_search'
    default:
      return itemType || 'tool'
  }
}

/** Best-effort, JSON-serializable input for a tool_use event. */
function toolInput(item: Record<string, unknown>): unknown {
  const itemType = itemTypeOf(item)
  switch (itemType) {
    case 'command_execution':
      return { command: item['command'] ?? null }
    case 'file_change':
      return { changes: item['changes'] ?? null }
    case 'web_search':
      return { query: item['query'] ?? null }
    case 'mcp_tool_call':
      return { server: item['server'] ?? null, tool: item['tool'] ?? null, arguments: item['arguments'] ?? null }
    default:
      return null
  }
}

/** Whether a completed item succeeded (defaults to true unless clearly failed). */
function isItemOk(item: Record<string, unknown>): boolean {
  if (item['status'] === 'failed') return false
  const exit = item['exit_code']
  if (typeof exit === 'number') return exit === 0
  return true
}

/** Short, safe one-line summary of a completed tool item (no full dumps). */
function summarizeItem(itemType: string, item: Record<string, unknown>): string | undefined {
  if (itemType === 'file_change') {
    const changes = item['changes']
    if (Array.isArray(changes)) {
      const parts: string[] = []
      for (const c of changes) {
        if (!isRecord(c)) continue
        const kind = typeof c['kind'] === 'string' ? c['kind'] : 'change'
        const p = typeof c['path'] === 'string' ? c['path'] : ''
        parts.push(p ? `${kind} ${p}` : kind)
      }
      if (parts.length > 0) return clip(parts.join(', '))
    }
  }
  if (itemType === 'command_execution') {
    const out = item['aggregated_output']
    if (typeof out === 'string' && out.trim().length > 0) return clip(out)
  }
  if (itemType === 'web_search') {
    const q = item['query']
    if (typeof q === 'string' && q.trim().length > 0) return clip(q)
  }
  return undefined
}

function clip(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length === 0) return ''
  return oneLine.length > 200 ? oneLine.slice(0, 197) + '…' : oneLine
}

function failureMessage(obj: Record<string, unknown>): string {
  const error = obj['error']
  if (isRecord(error) && typeof error['message'] === 'string') return error['message']
  if (typeof obj['message'] === 'string') return obj['message']
  return 'Agent run failed'
}

function mapUsage(usage: unknown): TokenUsage | undefined {
  const rec = isRecord(usage) ? usage : {}
  const out: TokenUsage = {}
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

  const inputTokens = num(rec['input_tokens'])
  const outputTokens = num(rec['output_tokens'])
  const cacheReadTokens = num(rec['cached_input_tokens'])

  if (inputTokens !== undefined) out.inputTokens = inputTokens
  if (outputTokens !== undefined) out.outputTokens = outputTokens
  if (cacheReadTokens !== undefined) out.cacheReadTokens = cacheReadTokens

  return Object.keys(out).length > 0 ? out : undefined
}
