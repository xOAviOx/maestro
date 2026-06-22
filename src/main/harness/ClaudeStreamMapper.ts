import type { AgentEvent, TokenUsage } from '@shared/types'
//
//
//
//
/**
 * Maps Claude Code's `--output-format stream-json --verbose` NDJSON onto the
 * normalized AgentEvent union. Stateful per run: it remembers tool_use ids so
 * later tool_result events can be attributed to a tool name.
 *
 * Defensive by design: unparseable or unrecognized lines yield no events
 * (they are ignored, never thrown). Verified against Claude Code v2.1.170:
 *   system/init     -> session_started (carries session_id)
 *   assistant       -> assistant_text / tool_use (one per content block)
 *   user            -> tool_result (content blocks reference tool_use_id)
 *   result          -> turn_complete (success) or error
 *   system/hook_*, rate_limit_event, etc. -> ignored
 */
export class ClaudeStreamMapper {
  private readonly toolNamesById = new Map<string, string>()

  mapLine(line: string): AgentEvent[] {
    const trimmed = line.trim()
    if (trimmed.length === 0) return []
    let obj: unknown
    try {
      obj = JSON.parse(trimmed)
    } catch {
      return [] // not JSON (e.g. a stray warning) — ignore
    }
    return this.mapObject(obj)
  }

  private mapObject(obj: unknown): AgentEvent[] {
    if (!isRecord(obj)) return []
    switch (obj['type']) {
      case 'system':
        if (obj['subtype'] === 'init' && typeof obj['session_id'] === 'string') {
          return [{ kind: 'session_started', sessionId: obj['session_id'] }]
        }
        return []
      case 'assistant':
        return this.mapAssistant(obj)
      case 'user':
        return this.mapUser(obj)
      case 'result':
        return this.mapResult(obj)
      default:
        return []
    }
  }

  private mapAssistant(obj: Record<string, unknown>): AgentEvent[] {
    const content = getContentBlocks(obj)
    const events: AgentEvent[] = []
    for (const block of content) {
      if (!isRecord(block)) continue
      if (block['type'] === 'text' && typeof block['text'] === 'string') {
        const text = block['text']
        if (text.trim().length > 0) events.push({ kind: 'assistant_text', text })
      } else if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
        if (typeof block['id'] === 'string') this.toolNamesById.set(block['id'], block['name'])
        events.push({ kind: 'tool_use', name: block['name'], input: block['input'] ?? null })
      }
    }
    return events
  }

  private mapUser(obj: Record<string, unknown>): AgentEvent[] {
    const content = getContentBlocks(obj)
    const events: AgentEvent[] = []
    for (const block of content) {
      if (!isRecord(block)) continue
      if (block['type'] !== 'tool_result') continue
      const toolUseId = typeof block['tool_use_id'] === 'string' ? block['tool_use_id'] : ''
      const name = this.toolNamesById.get(toolUseId) ?? 'tool'
      const ok = block['is_error'] !== true
      const summary = summarizeContent(block['content'])
      events.push(summary ? { kind: 'tool_result', name, ok, summary } : { kind: 'tool_result', name, ok })
    }
    return events
  }

  private mapResult(obj: Record<string, unknown>): AgentEvent[] {
    const sessionId = typeof obj['session_id'] === 'string' ? obj['session_id'] : ''
    const isError = obj['is_error'] === true || (typeof obj['subtype'] === 'string' && obj['subtype'] !== 'success')
    if (isError) {
      const message =
        typeof obj['result'] === 'string'
          ? obj['result']
          : typeof obj['subtype'] === 'string'
            ? `Agent run failed: ${obj['subtype']}`
            : 'Agent run failed'
      return [{ kind: 'error', message }]
    }
    const usage = mapUsage(obj)
    return usage
      ? [{ kind: 'turn_complete', sessionId, usage }]
      : [{ kind: 'turn_complete', sessionId }]
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function getContentBlocks(obj: Record<string, unknown>): unknown[] {
  const message = obj['message']
  if (!isRecord(message)) return []
  const content = message['content']
  return Array.isArray(content) ? content : []
}

/** Short, safe one-line summary of a tool_result's content (no full file dumps). */
function summarizeContent(content: unknown): string | undefined {
  let text: string | undefined
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (isRecord(block) && typeof block['text'] === 'string') parts.push(block['text'])
    }
    text = parts.join(' ')
  }
  if (!text) return undefined
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length === 0) return undefined
  return oneLine.length > 200 ? oneLine.slice(0, 197) + '…' : oneLine
}

function mapUsage(obj: Record<string, unknown>): TokenUsage | undefined {
  const usage = obj['usage']
  const usageRec = isRecord(usage) ? usage : {}
  const out: TokenUsage = {}
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

  const inputTokens = num(usageRec['input_tokens'])
  const outputTokens = num(usageRec['output_tokens'])
  const cacheReadTokens = num(usageRec['cache_read_input_tokens'])
  const cacheCreationTokens = num(usageRec['cache_creation_input_tokens'])
  const totalCostUsd = num(obj['total_cost_usd'])

  if (inputTokens !== undefined) out.inputTokens = inputTokens
  if (outputTokens !== undefined) out.outputTokens = outputTokens
  if (cacheReadTokens !== undefined) out.cacheReadTokens = cacheReadTokens
  if (cacheCreationTokens !== undefined) out.cacheCreationTokens = cacheCreationTokens
  if (totalCostUsd !== undefined) out.totalCostUsd = totalCostUsd

  // Model name from modelUsage map (first key) when present.
  const modelUsage = obj['modelUsage']
  if (isRecord(modelUsage)) {
    const firstModel = Object.keys(modelUsage)[0]
    if (firstModel) out.model = firstModel
  }

  return Object.keys(out).length > 0 ? out : undefined
}
