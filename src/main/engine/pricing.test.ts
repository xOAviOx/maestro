import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PricingTable, UsageEvent } from '@shared/types'
import {
  DEFAULT_PRICING,
  computeCostUsd,
  loadPricing,
  priceForModel,
  summarizeUsage
} from './pricing'

/** A minimal pricing table with easy round numbers for cost assertions. */
const TABLE: PricingTable = {
  lastVerified: '2026-01-01',
  models: {
    'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    // Deliberately a prefix of the key above's sibling family to test
    // longest-prefix-wins: 'claude-sonnet-4-5' must beat 'claude-sonnet-4'.
    'claude-sonnet-4-5': { input: 6, output: 30, cacheRead: 0.6, cacheWrite: 7.5 }
  }
}

let counter = 0
function usageEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  counter += 1
  return {
    id: `evt-${counter}`,
    workspaceId: 'ws-1',
    taskId: null,
    workflowId: null,
    createdAt: new Date().toISOString(),
    model: 'claude-sonnet-4',
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    cliCostUsd: null,
    ...overrides
  }
}

describe('priceForModel', () => {
  it('resolves an exact model key', () => {
    expect(priceForModel(TABLE, 'claude-opus-4')).toEqual(TABLE.models['claude-opus-4'])
  })

  it('resolves a version-dated id via prefix match', () => {
    expect(priceForModel(TABLE, 'claude-opus-4-20250514')).toEqual(TABLE.models['claude-opus-4'])
  })

  it('prefers the longest matching prefix', () => {
    expect(priceForModel(TABLE, 'claude-sonnet-4-5-20260101')).toEqual(
      TABLE.models['claude-sonnet-4-5']
    )
  })

  it('returns undefined for unknown models and null', () => {
    expect(priceForModel(TABLE, 'gpt-9000')).toBeUndefined()
    expect(priceForModel(TABLE, null)).toBeUndefined()
  })
})

describe('computeCostUsd', () => {
  it('prices all four token categories at the model rate', () => {
    const cost = computeCostUsd(
      {
        model: 'claude-sonnet-4',
        inputTokens: 1_000_000,
        outputTokens: 2_000_000,
        cacheReadTokens: 10_000_000,
        cacheCreationTokens: 1_000_000
      },
      TABLE
    )
    // 1M*3 + 2M*15 + 10M*0.3 + 1M*3.75 = 3 + 30 + 3 + 3.75
    expect(cost).toBeCloseTo(39.75, 10)
  })

  it('returns null (never a false $0) for an unknown model', () => {
    const cost = computeCostUsd(
      {
        model: 'mystery-model',
        inputTokens: 1000,
        outputTokens: 1000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0
      },
      TABLE
    )
    expect(cost).toBeNull()
  })

  it('is zero for a zero-token event with a known model', () => {
    expect(
      computeCostUsd(
        { model: 'claude-opus-4', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
        TABLE
      )
    ).toBe(0)
  })
})

describe('summarizeUsage', () => {
  it('sums token categories across events', () => {
    const summary = summarizeUsage(
      [
        usageEvent({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 5000, cacheCreationTokens: 200 }),
        usageEvent({ inputTokens: 50, outputTokens: 20, cacheReadTokens: 1000, cacheCreationTokens: 0 })
      ],
      TABLE
    )
    expect(summary.eventCount).toBe(2)
    expect(summary.inputTokens).toBe(150)
    expect(summary.outputTokens).toBe(30)
    expect(summary.cacheReadTokens).toBe(6000)
    expect(summary.cacheCreationTokens).toBe(200)
    expect(summary.costComplete).toBe(true)
  })

  it('prefers the CLI-reported cost over the computed one', () => {
    const summary = summarizeUsage(
      [usageEvent({ inputTokens: 1_000_000, cliCostUsd: 0.42 })], // computed would be $3
      TABLE
    )
    expect(summary.totalCostUsd).toBeCloseTo(0.42, 10)
    expect(summary.costComplete).toBe(true)
  })

  it('falls back to pricing when the CLI reported no cost', () => {
    const summary = summarizeUsage(
      [usageEvent({ model: 'claude-opus-4', outputTokens: 1_000_000, cliCostUsd: null })],
      TABLE
    )
    expect(summary.totalCostUsd).toBeCloseTo(75, 10)
    expect(summary.costComplete).toBe(true)
  })

  it('mixes models per event (each priced at its own rate)', () => {
    const summary = summarizeUsage(
      [
        usageEvent({ model: 'claude-opus-4', inputTokens: 1_000_000 }), // $15
        usageEvent({ model: 'claude-sonnet-4', inputTokens: 1_000_000 }) // $3
      ],
      TABLE
    )
    expect(summary.totalCostUsd).toBeCloseTo(18, 10)
  })

  it('flags an incomplete total when any event is unpriceable', () => {
    const summary = summarizeUsage(
      [
        usageEvent({ model: 'claude-opus-4', inputTokens: 1_000_000 }),
        usageEvent({ model: 'mystery-model', inputTokens: 999, cliCostUsd: null })
      ],
      TABLE
    )
    expect(summary.costComplete).toBe(false)
    // Known events still contribute — the total is a best-effort floor.
    expect(summary.totalCostUsd).toBeCloseTo(15, 10)
    // Tokens are still counted even when cost is unknown.
    expect(summary.inputTokens).toBe(1_000_999)
  })

  it('counts an unknown-model event WITH a CLI cost as complete', () => {
    const summary = summarizeUsage(
      [usageEvent({ model: 'mystery-model', cliCostUsd: 1.5 })],
      TABLE
    )
    expect(summary.costComplete).toBe(true)
    expect(summary.totalCostUsd).toBeCloseTo(1.5, 10)
  })

  it('returns zeros (and complete) for no events', () => {
    const summary = summarizeUsage([], TABLE)
    expect(summary).toEqual({
      eventCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalCostUsd: 0,
      costComplete: true
    })
  })
})

describe('loadPricing', () => {
  const tempFiles: string[] = []

  function tempPricingPath(): string {
    const p = path.join(os.tmpdir(), `maestro-pricing-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    tempFiles.push(p)
    return p
  }

  afterEach(() => {
    for (const p of tempFiles.splice(0)) {
      try {
        fs.rmSync(p, { force: true })
      } catch {
        // ignore
      }
    }
  })

  it('falls back to defaults when no override file exists', () => {
    expect(loadPricing(tempPricingPath())).toEqual(DEFAULT_PRICING)
  })

  it('loads a valid override file', () => {
    const p = tempPricingPath()
    fs.writeFileSync(p, JSON.stringify(TABLE))
    expect(loadPricing(p)).toEqual(TABLE)
  })

  it('falls back to defaults on malformed JSON', () => {
    const p = tempPricingPath()
    fs.writeFileSync(p, '{ not json !!!')
    expect(loadPricing(p)).toEqual(DEFAULT_PRICING)
  })

  it('falls back to defaults on schema-invalid content', () => {
    const p = tempPricingPath()
    fs.writeFileSync(p, JSON.stringify({ models: { x: { input: 'free' } } }))
    expect(loadPricing(p)).toEqual(DEFAULT_PRICING)
  })
})
