import type { ModelPrice, PricingTable, UsageEvent, UsageSummary } from './types'

/**
 * Pure cost math shared by the main process (pricing.ts) and the renderer
 * (Dashboard — Phase 2.2). Kept free of any Node built-ins (no `fs`/`path`) so
 * the renderer can price events client-side from a pricing table fetched over
 * IPC. The fs-backed loader/writer lives in `src/main/engine/pricing.ts`, which
 * re-exports these so existing imports keep working.
 */

/**
 * Built-in model pricing — USD per 1,000,000 tokens. Kept in sync with
 * `config/pricing.json` (the editable seed users copy to
 * `<maestroHome>/pricing.json`). VERIFY against https://www.anthropic.com/pricing;
 * users override by editing that file rather than this constant.
 */
export const DEFAULT_PRICING: PricingTable = {
  lastVerified: '2026-07-06',
  models: {
    'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    'claude-haiku-4': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    'claude-3-5-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    'claude-3-5-haiku': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    'claude-3-opus': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }
  }
}

/** The usage fields needed to price a turn. */
type Priceable = Pick<
  UsageEvent,
  'model' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheCreationTokens'
>

/**
 * Resolve a model id to its rate: an exact key first, then the longest table key
 * that is a prefix of the id (so version-dated ids like `claude-opus-4-20250514`
 * resolve to the `claude-opus-4` family). Returns undefined for unknown models.
 */
export function priceForModel(table: PricingTable, model: string | null): ModelPrice | undefined {
  if (!model) return undefined
  const exact = table.models[model]
  if (exact) return exact
  let bestKey: string | undefined
  for (const key of Object.keys(table.models)) {
    if (model.startsWith(key) && (bestKey === undefined || key.length > bestKey.length)) {
      bestKey = key
    }
  }
  return bestKey ? table.models[bestKey] : undefined
}

/** Cost of one usage sample in USD, or null when the model is unknown (never a false $0). */
export function computeCostUsd(usage: Priceable, table: PricingTable): number | null {
  const price = priceForModel(table, usage.model)
  if (!price) return null
  const perMillion = 1_000_000
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheCreationTokens * price.cacheWrite) /
    perMillion
  )
}

/**
 * Best-effort cost of one persisted event: the CLI's own reported cost when
 * present (authoritative), else pricing-table computation, else null (unknown
 * model + no CLI cost) so callers can flag it rather than show a false $0.
 */
export function eventCostUsd(event: UsageEvent, table: PricingTable): number | null {
  return event.cliCostUsd ?? computeCostUsd(event, table)
}

/**
 * Aggregate a set of usage events. Per-event cost prefers the CLI's own
 * `cliCostUsd`, falling back to pricing computation; `costComplete` is false when
 * any event's cost is unavailable, so callers can flag an incomplete total rather
 * than present a misleadingly precise figure.
 */
export function summarizeUsage(events: UsageEvent[], table: PricingTable): UsageSummary {
  let inputTokens = 0
  let outputTokens = 0
  let cacheCreationTokens = 0
  let cacheReadTokens = 0
  let totalCostUsd = 0
  let costComplete = true
  for (const e of events) {
    inputTokens += e.inputTokens
    outputTokens += e.outputTokens
    cacheCreationTokens += e.cacheCreationTokens
    cacheReadTokens += e.cacheReadTokens
    const cost = e.cliCostUsd ?? computeCostUsd(e, table)
    if (cost === null) costComplete = false
    else totalCostUsd += cost
  }
  return {
    eventCount: events.length,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    totalCostUsd,
    costComplete
  }
}
