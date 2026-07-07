import type { PricingTable, UsageEvent } from './types'
import { eventCostUsd } from './cost'

/**
 * Usage aggregation + formatting for the Dashboard (Phase 2.2). Pure and free of
 * React/Node so it can be unit-tested and shared. Cost math itself lives in
 * `./cost` (unit-tested); everything here is presentation: grouping events by
 * agent/workflow, building the cumulative cost series, burn rate, and formatting
 * money/tokens.
 *
 * Every cost is best-effort: `eventCostUsd` returns null for an unknown model
 * with no CLI-reported cost, surfaced here as an "unavailable" flag rather than
 * a false $0 (per the spec's "never display false zeros" rule).
 */

/** A cost that may be partially unknown: the summable USD plus a completeness flag. */
export interface CostRollup {
  /** Sum of the events whose cost is known. */
  costUsd: number
  /** False when at least one event's cost was unavailable (unknown model). */
  complete: boolean
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  eventCount: number
}

export const EMPTY_ROLLUP: CostRollup = {
  costUsd: 0,
  complete: true,
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  eventCount: 0
}

/** Total tokens (all four kinds) for one event. */
export function eventTokens(e: UsageEvent): number {
  return e.inputTokens + e.outputTokens + e.cacheCreationTokens + e.cacheReadTokens
}

/** Aggregate a set of events into a single rollup. */
export function rollup(events: UsageEvent[], pricing: PricingTable | null): CostRollup {
  const acc: CostRollup = { ...EMPTY_ROLLUP }
  for (const e of events) {
    acc.inputTokens += e.inputTokens
    acc.outputTokens += e.outputTokens
    acc.cacheCreationTokens += e.cacheCreationTokens
    acc.cacheReadTokens += e.cacheReadTokens
    acc.eventCount += 1
    const cost = pricing ? eventCostUsd(e, pricing) : e.cliCostUsd
    if (cost === null || cost === undefined) acc.complete = false
    else acc.costUsd += cost
  }
  return acc
}

/** Events with `createdAt` at or after the session boundary (lexical compare is
 * valid for the ISO-8601 timestamps main writes). */
export function sessionEvents(events: UsageEvent[], sessionStartedAt: string | null): UsageEvent[] {
  if (!sessionStartedAt) return events
  return events.filter((e) => e.createdAt >= sessionStartedAt)
}

/** Group events by workspace id, preserving input order within each group. */
export function groupByWorkspace(events: UsageEvent[]): Map<string, UsageEvent[]> {
  const map = new Map<string, UsageEvent[]>()
  for (const e of events) {
    const arr = map.get(e.workspaceId)
    if (arr) arr.push(e)
    else map.set(e.workspaceId, [e])
  }
  return map
}

/** Group events by workflow id (null → "no workflow" bucket, key ''). */
export function groupByWorkflow(events: UsageEvent[]): Map<string, UsageEvent[]> {
  const map = new Map<string, UsageEvent[]>()
  for (const e of events) {
    const key = e.workflowId ?? ''
    const arr = map.get(key)
    if (arr) arr.push(e)
    else map.set(key, [e])
  }
  return map
}

/**
 * Token burn rate over a trailing window (default 5 min): total tokens in the
 * window divided by the window length in minutes. `now` is passed in (not read
 * from Date here) so callers control the clock for tests/throttling.
 */
export function burnRateTokensPerMin(
  events: UsageEvent[],
  now: number,
  windowMs = 5 * 60 * 1000
): number {
  const cutoff = now - windowMs
  let tokens = 0
  for (const e of events) {
    if (Date.parse(e.createdAt) >= cutoff) tokens += eventTokens(e)
  }
  return tokens / (windowMs / 60000)
}

/** One point on the cumulative-cost time series, with a column per agent. */
export interface CumulativePoint {
  t: number
  /** Cumulative total across all agents up to this point. */
  total: number
  /** Cumulative per-agent cost, keyed by workspace id. */
  [agentKey: string]: number
}

/**
 * Build a cumulative-cost-over-time series, stacked by agent. Events are sorted
 * oldest→newest; each point carries the running total per agent so a stacked
 * area chart can render contribution bands. Unknown-cost events advance time but
 * add 0 (they can't be priced) — the tiles flag incompleteness separately.
 */
export function cumulativeSeries(
  events: UsageEvent[],
  pricing: PricingTable | null,
  agentIds: string[]
): CumulativePoint[] {
  const ordered = [...events].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  const running = new Map<string, number>(agentIds.map((id) => [id, 0]))
  let total = 0
  const points: CumulativePoint[] = []
  for (const e of ordered) {
    const cost = (pricing ? eventCostUsd(e, pricing) : e.cliCostUsd) ?? 0
    running.set(e.workspaceId, (running.get(e.workspaceId) ?? 0) + cost)
    total += cost
    const point: CumulativePoint = { t: Date.parse(e.createdAt), total }
    for (const id of agentIds) point[id] = running.get(id) ?? 0
    points.push(point)
  }
  return points
}

// --- formatting -------------------------------------------------------------

/** Format a USD amount: `$0.42`, `$1,234.50`, `<$0.01` for tiny non-zero. */
export function formatUsd(amount: number): string {
  if (amount > 0 && amount < 0.01) return '<$0.01'
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** A cost rollup as text; appends `+` when the total is known to be incomplete. */
export function formatRollupCost(r: CostRollup): string {
  if (r.eventCount === 0) return '$0.00'
  if (r.costUsd === 0 && !r.complete) return 'unavailable'
  return `${formatUsd(r.costUsd)}${r.complete ? '' : '+'}`
}

/** Compact token count: `128k`, `3.4M`, `847`. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return `${Math.round(n)}`
}
