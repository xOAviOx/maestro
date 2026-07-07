import { describe, expect, it } from 'vitest'
import type { PricingTable, UsageEvent } from './types'
import {
  burnRateTokensPerMin,
  cumulativeSeries,
  eventTokens,
  formatRollupCost,
  formatTokens,
  formatUsd,
  groupByWorkflow,
  rollup,
  sessionEvents
} from './usage'

/** Round-number rates so cost assertions are exact. input $10/Mtok, output $20/Mtok. */
const TABLE: PricingTable = {
  lastVerified: '2026-01-01',
  models: {
    m: { input: 10, output: 20, cacheRead: 1, cacheWrite: 2 }
  }
}

/** Build a usage event with sensible defaults; override what a test cares about. */
function evt(over: Partial<UsageEvent>): UsageEvent {
  return {
    id: Math.random().toString(36).slice(2),
    workspaceId: 'ws1',
    taskId: null,
    workflowId: null,
    createdAt: '2026-07-07T00:00:00.000Z',
    model: 'm',
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    cliCostUsd: null,
    ...over
  }
}

describe('rollup', () => {
  it('sums tokens and prices per event from the table', () => {
    const r = rollup(
      [
        evt({ inputTokens: 1_000_000, outputTokens: 500_000 }),
        evt({ inputTokens: 2_000_000 })
      ],
      TABLE
    )
    expect(r.eventCount).toBe(2)
    expect(r.inputTokens).toBe(3_000_000)
    expect(r.outputTokens).toBe(500_000)
    // (1M*10 + 0.5M*20)/1M = 20; (2M*10)/1M = 20 → 40
    expect(r.costUsd).toBeCloseTo(40, 9)
    expect(r.complete).toBe(true)
  })

  it("prefers the CLI's own reported cost over computed", () => {
    const r = rollup([evt({ inputTokens: 1_000_000, cliCostUsd: 0.123 })], TABLE)
    expect(r.costUsd).toBeCloseTo(0.123, 9)
  })

  it('flags incompleteness for an unknown model with no CLI cost (never a false $0)', () => {
    const r = rollup([evt({ model: 'unknown-x', inputTokens: 1_000_000, cliCostUsd: null })], TABLE)
    expect(r.complete).toBe(false)
    expect(r.costUsd).toBe(0)
    expect(formatRollupCost(r)).toBe('unavailable')
  })
})

describe('sessionEvents', () => {
  it('keeps only events at/after the session boundary', () => {
    const events = [
      evt({ createdAt: '2026-07-07T09:00:00.000Z' }),
      evt({ createdAt: '2026-07-07T10:00:00.000Z' }),
      evt({ createdAt: '2026-07-07T11:00:00.000Z' })
    ]
    const kept = sessionEvents(events, '2026-07-07T10:00:00.000Z')
    expect(kept).toHaveLength(2)
  })

  it('returns all events when no boundary is known', () => {
    const events = [evt({}), evt({})]
    expect(sessionEvents(events, null)).toHaveLength(2)
  })
})

describe('burnRateTokensPerMin', () => {
  it('averages only in-window tokens over the window minutes', () => {
    const now = Date.parse('2026-07-07T00:10:00.000Z')
    const events = [
      // 2 min ago — in the 5-min window: 300k tokens total
      evt({ createdAt: '2026-07-07T00:08:00.000Z', inputTokens: 200_000, outputTokens: 100_000 }),
      // 9 min ago — outside the window, ignored
      evt({ createdAt: '2026-07-07T00:01:00.000Z', inputTokens: 999_999 })
    ]
    // 300k / 5 min = 60k tokens/min
    expect(burnRateTokensPerMin(events, now)).toBeCloseTo(60_000, 6)
  })
})

describe('cumulativeSeries', () => {
  it('accumulates per-agent running totals in time order', () => {
    const events = [
      evt({ workspaceId: 'a', createdAt: '2026-07-07T00:00:02.000Z', inputTokens: 1_000_000 }),
      evt({ workspaceId: 'b', createdAt: '2026-07-07T00:00:01.000Z', inputTokens: 1_000_000 })
    ]
    const series = cumulativeSeries(events, TABLE, ['a', 'b'])
    expect(series).toHaveLength(2)
    const [p0, p1] = series as [(typeof series)[number], (typeof series)[number]]
    // Sorted oldest→newest: b (t=1s) then a (t=2s)
    expect(p0.b).toBeCloseTo(10, 9)
    expect(p0.a).toBe(0)
    expect(p1.a).toBeCloseTo(10, 9)
    expect(p1.total).toBeCloseTo(20, 9)
  })
})

describe('groupByWorkflow', () => {
  it('buckets null workflow ids under the empty-string key', () => {
    const m = groupByWorkflow([evt({ workflowId: 'wf1' }), evt({ workflowId: null })])
    expect(m.get('wf1')).toHaveLength(1)
    expect(m.get('')).toHaveLength(1)
  })
})

describe('formatting', () => {
  it('formats money and tiny non-zero amounts', () => {
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(0.005)).toBe('<$0.01')
    expect(formatUsd(1234.5)).toBe('$1,234.50')
  })

  it('formats compact token counts', () => {
    expect(formatTokens(847)).toBe('847')
    expect(formatTokens(1500)).toBe('1.5k')
    expect(formatTokens(128_000)).toBe('128k')
    expect(formatTokens(3_400_000)).toBe('3.4M')
  })

  it('eventTokens sums all four token kinds', () => {
    expect(
      eventTokens(
        evt({ inputTokens: 1, outputTokens: 2, cacheCreationTokens: 3, cacheReadTokens: 4 })
      )
    ).toBe(10)
  })
})
