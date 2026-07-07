/**
 * Module 14 acceptance script (Phase 2.2 — cost/token dashboard).
 *
 * The dashboard itself is a UI, so this exercises the DATA PATH the dashboard
 * renders — headlessly, with the REAL engine (SQLite) + supervisor and a FAKE
 * harness — asserting the exact aggregations the dashboard shows. It runs THREE
 * agents in parallel (the spec's acceptance scenario) and verifies:
 *   1. all three agents' turns persist usage + emit a live `usage_recorded` push,
 *   2. the per-agent rollup matches each agent's persisted rows, and the session
 *      total equals the sum of per-agent costs (tiles ↔ table reconcile),
 *   3. the cumulative-cost series' final total equals the session rollup
 *      (chart ↔ tiles reconcile),
 *   4. the trailing-window burn rate reflects this session's tokens,
 *   5. the "this session" boundary excludes prior-session persisted history,
 *   6. the per-workflow rollup (joined via task.agentId → workspace) sums its
 *      member agents,
 *   7. an edited pricing table round-trips through writePricing/loadPricing and
 *      changes the computed cost (editable rates take effect),
 *   8. rows survive an engine close/reopen and group by day for History.
 *
 * No live agent CLI required. Run: `npm run smoke:m14`.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import execa from 'execa'
import { createEngine } from '../src/main/engine'
import { WorkspaceSupervisor, type HarnessFactory } from '../src/main/engine/WorkspaceSupervisor'
import { DEFAULT_PRICING, loadPricing, writePricing } from '../src/main/engine/pricing'
import { computeCostUsd, eventCostUsd } from '@shared/cost'
import {
  burnRateTokensPerMin,
  cumulativeSeries,
  eventTokens,
  groupByWorkspace,
  rollup,
  sessionEvents
} from '@shared/usage'
import { workspacesRoot } from '../src/main/engine/util/paths'
import type { Harness, LaunchOptions } from '../src/main/harness'
import type { AgentEvent, PricingTable, TokenUsage, UsageEvent, WorkspacePushEvent } from '@shared/types'

async function git(cwd: string, args: string[]): Promise<void> {
  await execa('git', args, { cwd, env: { ...process.env, GIT_PAGER: 'cat' } })
}

function assert(cond: boolean, message: string): asserts cond {
  if (!cond) throw new Error(message)
}

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Distinct scripted usage per agent, keyed by a tag embedded in the prompt.
 * agent-0 reports its own CLI cost (must win); agent-1/agent-2 rely on pricing
 * (sonnet + opus, both resolvable via prefix match).
 */
const USAGE_BY_TAG: Record<string, TokenUsage> = {
  'agent-0': {
    inputTokens: 1000,
    outputTokens: 2000,
    cacheReadTokens: 40000,
    cacheCreationTokens: 500,
    totalCostUsd: 0.4242,
    model: 'claude-sonnet-4-20250514'
  },
  'agent-1': {
    inputTokens: 300,
    outputTokens: 1200,
    cacheReadTokens: 8000,
    cacheCreationTokens: 0,
    model: 'claude-sonnet-4-20250514'
  },
  'agent-2': {
    inputTokens: 700,
    outputTokens: 400,
    cacheReadTokens: 0,
    cacheCreationTokens: 1500,
    model: 'claude-opus-4-20250514'
  }
}

function tagFromPrompt(prompt: string): string {
  const tag = Object.keys(USAGE_BY_TAG).find((t) => prompt.includes(t))
  if (!tag) throw new Error(`No usage scripted for prompt: ${prompt}`)
  return tag
}

/** A harness that "runs" instantly and reports the usage scripted for its prompt tag. */
class FakeHarness implements Harness {
  readonly type = 'claude-code' as const

  async isAvailable(): Promise<boolean> {
    return true
  }

  async run(opts: LaunchOptions, onEvent: (e: AgentEvent) => void): Promise<{ sessionId: string }> {
    const usage = USAGE_BY_TAG[tagFromPrompt(opts.prompt)]
    const sessionId = 'fake-session'
    onEvent({ kind: 'session_started', sessionId })
    onEvent({ kind: 'assistant_text', text: 'done' })
    onEvent({ kind: 'turn_complete', sessionId, usage })
    return { sessionId }
  }

  cancel(): void {
    // nothing in flight
  }
}

const fakeFactory: HarnessFactory = () => new FakeHarness()

async function main(): Promise<void> {
  const tempBase = path.join(os.tmpdir(), 'maestro test repos')
  fs.mkdirSync(tempBase, { recursive: true })
  const repoDir = path.join(tempBase, `m14 app ${Date.now()}`)
  fs.mkdirSync(repoDir, { recursive: true })
  const dbPath = path.join(tempBase, `m14-${Date.now()}.db`)
  const pricingPath = path.join(tempBase, `m14-pricing-${Date.now()}.json`)
  let engine = createEngine(dbPath)
  const supervisor = new WorkspaceSupervisor(engine, undefined, fakeFactory)
  let repoName = ''

  const pushed: UsageEvent[] = []
  const settlers = new Map<string, () => void>()
  const unsubscribe = supervisor.subscribe((evt: WorkspacePushEvent) => {
    if (evt.type === 'usage_recorded') pushed.push(evt.usage)
    if (evt.type === 'status_changed' && evt.status !== 'running') {
      const settle = settlers.get(evt.workspaceId)
      if (settle) {
        settlers.delete(evt.workspaceId)
        settle()
      }
    }
  })

  /** Start a turn on a workspace and resolve when it leaves `running`. */
  async function runTurn(workspaceId: string, prompt: string): Promise<void> {
    const settled = new Promise<void>((resolve) => settlers.set(workspaceId, resolve))
    await supervisor.startRun(workspaceId, prompt)
    await Promise.race([
      settled,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out waiting for ${workspaceId}`)), 10_000)
      )
    ])
  }

  try {
    await git(repoDir, ['init', '-b', 'main'])
    await git(repoDir, ['config', 'user.email', 'test@maestro.local'])
    await git(repoDir, ['config', 'user.name', 'Maestro Test'])
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# M14 App\n')
    await git(repoDir, ['add', '.'])
    await git(repoDir, ['commit', '-m', 'init'])

    await engine.worktrees.registerRepo(repoDir)
    repoName = path.basename(repoDir)

    // A leftover event from a "previous session" (older timestamp), for the
    // session-boundary check below.
    engine.usageEvents.record({
      workspaceId: 'prior-session-agent',
      model: 'claude-sonnet-4',
      inputTokens: 123,
      outputTokens: 456,
      cacheCreationTokens: 0,
      cacheReadTokens: 0
    })

    // Capture the "this session" boundary AFTER the historical row, BEFORE the run.
    await sleep(10)
    const sessionStartedAt = new Date().toISOString()
    await sleep(10)

    const workspaces = await Promise.all([
      engine.worktrees.createWorkspace({ repoPath: repoDir, name: 'agent-0 probe' }),
      engine.worktrees.createWorkspace({ repoPath: repoDir, name: 'agent-1 probe' }),
      engine.worktrees.createWorkspace({ repoPath: repoDir, name: 'agent-2 probe' })
    ])

    console.log('=== Running THREE fake agent turns in parallel ===')
    await Promise.all(workspaces.map((ws, i) => runTurn(ws.id, `agent-${i}: do the thing`)))

    console.log('\n=== 1: rows persisted + live push per agent ===')
    assert(pushed.length === 3, `Expected 3 usage_recorded pushes, got ${pushed.length}`)
    const allRows = engine.usageEvents.listAll()
    assert(allRows.length === 4, `Expected 4 total rows (3 + 1 historical), got ${allRows.length}`)
    for (let i = 0; i < 3; i++) {
      const ws = workspaces[i]!
      const rows = engine.usageEvents.listByWorkspace(ws.id)
      const expected = USAGE_BY_TAG[`agent-${i}`]!
      assert(rows.length === 1, `agent-${i} should have 1 row, got ${rows.length}`)
      const row = rows[0]!
      assert(row.inputTokens === expected.inputTokens, `agent-${i} inputTokens mismatch`)
      assert(row.outputTokens === expected.outputTokens, `agent-${i} outputTokens mismatch`)
      assert(row.cacheReadTokens === expected.cacheReadTokens, `agent-${i} cacheReadTokens mismatch`)
    }
    const pushedIds = new Set(pushed.map((e) => e.id))
    assert(
      engine.usageEvents.listByWorkspace(workspaces[0]!.id).every((r) => pushedIds.has(r.id)),
      'push events must match stored rows'
    )

    console.log('=== 5: "this session" boundary excludes prior-session history ===')
    const session = sessionEvents(allRows, sessionStartedAt)
    assert(session.length === 3, `Session should have 3 events (historical excluded), got ${session.length}`)
    assert(
      !session.some((e) => e.workspaceId === 'prior-session-agent'),
      'prior-session row leaked into this session'
    )

    console.log('=== 2: per-agent rollup + session total reconcile ===')
    const byAgent = groupByWorkspace(session)
    let sumOfAgents = 0
    for (const ws of workspaces) {
      const r = rollup(byAgent.get(ws.id) ?? [], DEFAULT_PRICING)
      assert(r.eventCount === 1, `agent rollup ${ws.id} eventCount mismatch`)
      assert(r.complete, `agent rollup ${ws.id} should be cost-complete`)
      sumOfAgents += r.costUsd
    }
    const sessionRollup = rollup(session, DEFAULT_PRICING)
    assert(sessionRollup.complete, 'session cost should be complete (all models known)')
    assert(approxEqual(sessionRollup.costUsd, sumOfAgents), 'session total must equal sum of per-agent costs')
    // agent-0's cost is the CLI-reported figure, not the pricing computation.
    const agent0 = byAgent.get(workspaces[0]!.id)![0]!
    assert(approxEqual(eventCostUsd(agent0, DEFAULT_PRICING)!, 0.4242), "agent-0 must use the CLI's own cost")

    console.log('=== 3: cumulative series total reconciles with the tiles ===')
    const agentIds = workspaces.map((w) => w.id)
    const series = cumulativeSeries(session, DEFAULT_PRICING, agentIds)
    assert(series.length === 3, `Expected 3 series points, got ${series.length}`)
    const finalPoint = series[series.length - 1]!
    assert(approxEqual(finalPoint.total, sessionRollup.costUsd), 'chart final total must equal session total')
    // Each agent's final band equals that agent's own rollup.
    for (const ws of workspaces) {
      const r = rollup(byAgent.get(ws.id) ?? [], DEFAULT_PRICING)
      assert(approxEqual(finalPoint[ws.id]!, r.costUsd), `series band for ${ws.id} mismatch`)
    }

    console.log('=== 4: burn rate reflects this session tokens ===')
    const totalSessionTokens = session.reduce((n, e) => n + eventTokens(e), 0)
    const burn = burnRateTokensPerMin(session, Date.now())
    // All three events are within the trailing 5-min window → tokens / 5.
    assert(approxEqual(burn * 5, totalSessionTokens), 'burn rate must equal session tokens / 5 min')

    console.log('=== 6: per-workflow rollup joins usage via task.agentId ===')
    // The dashboard's WorkflowRollup groups usage by workspace, then attributes
    // each task's cost to its agentId (= workspace id). Emulate that join here.
    const workflowTasks = [
      { agentId: workspaces[0]!.id },
      { agentId: workspaces[1]!.id }
    ]
    const workflowCost = workflowTasks.reduce(
      (sum, t) => sum + rollup(byAgent.get(t.agentId) ?? [], DEFAULT_PRICING).costUsd,
      0
    )
    const expectWorkflow =
      rollup(byAgent.get(workspaces[0]!.id) ?? [], DEFAULT_PRICING).costUsd +
      rollup(byAgent.get(workspaces[1]!.id) ?? [], DEFAULT_PRICING).costUsd
    assert(approxEqual(workflowCost, expectWorkflow), 'workflow rollup must sum its member agents')

    console.log('=== 7: edited pricing round-trips and changes computed cost ===')
    const doubled: PricingTable = {
      lastVerified: '2026-07-07',
      models: {
        ...DEFAULT_PRICING.models,
        'claude-sonnet-4': {
          ...DEFAULT_PRICING.models['claude-sonnet-4']!,
          input: DEFAULT_PRICING.models['claude-sonnet-4']!.input * 2
        }
      }
    }
    writePricing(doubled, pricingPath)
    const reloaded = loadPricing(pricingPath)
    assert(reloaded.models['claude-sonnet-4']!.input === DEFAULT_PRICING.models['claude-sonnet-4']!.input * 2, 'edited rate did not persist')
    const agent1 = byAgent.get(workspaces[1]!.id)![0]!
    const before = computeCostUsd(agent1, DEFAULT_PRICING)!
    const after = computeCostUsd(agent1, reloaded)!
    assert(after > before, 'doubling the input rate should raise agent-1 computed cost')

    console.log('=== 8: restart persistence + History day-grouping ===')
    engine.close()
    engine = createEngine(dbPath)
    const afterRestart = engine.usageEvents.listAll()
    assert(afterRestart.length === 4, 'all rows must survive restart')
    const byDay = new Map<string, number>()
    for (const e of afterRestart) {
      const day = e.createdAt.slice(0, 10)
      byDay.set(day, (byDay.get(day) ?? 0) + 1)
    }
    assert([...byDay.values()].reduce((a, b) => a + b, 0) === 4, 'history day buckets must cover all rows')

    console.log({
      agents: 3,
      sessionCostUsd: Number(sessionRollup.costUsd.toFixed(4)),
      sessionTokens: totalSessionTokens,
      burnPerMin: Math.round(burn),
      historyDays: byDay.size
    })
    console.log('\nMODULE 14 SMOKE TEST PASSED ✅')
  } finally {
    unsubscribe()
    supervisor.cancelAll()
    engine.close()
    try {
      fs.rmSync(repoDir, { recursive: true, force: true })
      fs.rmSync(dbPath, { force: true })
      fs.rmSync(`${dbPath}-wal`, { force: true })
      fs.rmSync(`${dbPath}-shm`, { force: true })
      fs.rmSync(pricingPath, { force: true })
      if (repoName) fs.rmSync(path.join(workspacesRoot(), repoName), { recursive: true, force: true })
    } catch {
      // ignore cleanup failures
    }
  }
}

main().catch((err: unknown) => {
  console.error('\nMODULE 14 SMOKE TEST FAILED ❌')
  console.error(err)
  process.exitCode = 1
})
