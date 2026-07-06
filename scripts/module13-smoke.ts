/**
 * Module 13 acceptance script (Phase 2.1 — usage/cost collection pipeline).
 *
 * Runs the REAL engine (SQLite) + supervisor with a FAKE harness that emits
 * turn_complete events carrying known usage numbers, then verifies:
 *   1. each turn's usage lands in the usage_events table with exact numbers,
 *   2. a `usage_recorded` push event is broadcast per turn (live dashboard feed),
 *   3. listByWorkspace filters correctly (other workspaces' rows excluded),
 *   4. summarizeUsage + pricing produce the expected cost (CLI-reported cost
 *      preferred; pricing-table fallback via model prefix match otherwise),
 *   5. rows survive an engine close/reopen (restart persistence).
 *
 * No live agent CLI required. Run: `npm run smoke:m13`.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import execa from 'execa'
import { createEngine } from '../src/main/engine'
import { WorkspaceSupervisor, type HarnessFactory } from '../src/main/engine/WorkspaceSupervisor'
import { DEFAULT_PRICING, computeCostUsd, summarizeUsage } from '../src/main/engine/pricing'
import { workspacesRoot } from '../src/main/engine/util/paths'
import type { Harness } from '../src/main/harness'
import type { AgentEvent, TokenUsage, UsageEvent, WorkspacePushEvent } from '@shared/types'

async function git(cwd: string, args: string[]): Promise<void> {
  await execa('git', args, { cwd, env: { ...process.env, GIT_PAGER: 'cat' } })
}

function assert(cond: boolean, message: string): asserts cond {
  if (!cond) throw new Error(message)
}

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9
}

/** Known per-turn usage the fake harness will report, in order. */
const TURNS: TokenUsage[] = [
  {
    // Turn 1: CLI reports its own cost — must win over the pricing table.
    inputTokens: 1200,
    outputTokens: 3400,
    cacheReadTokens: 56000,
    cacheCreationTokens: 780,
    totalCostUsd: 0.1234,
    model: 'claude-sonnet-4-20250514'
  },
  {
    // Turn 2: no CLI cost — cost must be derived from the pricing table via
    // the 'claude-sonnet-4' prefix match.
    inputTokens: 250,
    outputTokens: 900,
    cacheReadTokens: 12000,
    cacheCreationTokens: 0,
    model: 'claude-sonnet-4-20250514'
  }
]

/** A harness that "runs" instantly and reports scripted usage per turn. */
class FakeHarness implements Harness {
  readonly type = 'claude-code' as const
  private static turn = 0

  async isAvailable(): Promise<boolean> {
    return true
  }

  async run(
    _opts: unknown,
    onEvent: (e: AgentEvent) => void
  ): Promise<{ sessionId: string }> {
    const usage = TURNS[FakeHarness.turn]
    FakeHarness.turn = Math.min(FakeHarness.turn + 1, TURNS.length - 1)
    const sessionId = 'fake-session'
    onEvent({ kind: 'session_started', sessionId })
    onEvent({ kind: 'assistant_text', text: 'done' })
    onEvent(
      usage
        ? { kind: 'turn_complete', sessionId, usage }
        : { kind: 'turn_complete', sessionId }
    )
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
  const repoDir = path.join(tempBase, `m13 app ${Date.now()}`)
  fs.mkdirSync(repoDir, { recursive: true })
  const dbPath = path.join(tempBase, `m13-${Date.now()}.db`)
  let engine = createEngine(dbPath)
  const supervisor = new WorkspaceSupervisor(engine, undefined, fakeFactory)
  let repoName = ''

  const pushed: UsageEvent[] = []
  let statusResolve: ((status: string) => void) | null = null
  const unsubscribe = supervisor.subscribe((evt: WorkspacePushEvent) => {
    if (evt.type === 'usage_recorded') pushed.push(evt.usage)
    if (evt.type === 'status_changed' && evt.status !== 'running' && statusResolve) {
      statusResolve(evt.status)
      statusResolve = null
    }
  })

  /** Start a turn and wait until the workspace leaves `running`. */
  async function runTurn(workspaceId: string): Promise<void> {
    const settled = new Promise<string>((resolve) => {
      statusResolve = resolve
    })
    await supervisor.startRun(workspaceId, 'do the thing')
    const status = await Promise.race([
      settled,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timed out waiting for turn to settle')), 10_000)
      )
    ])
    assert(status === 'awaiting_input', `Turn ended with status ${status}, expected awaiting_input`)
  }

  try {
    await git(repoDir, ['init', '-b', 'main'])
    await git(repoDir, ['config', 'user.email', 'test@maestro.local'])
    await git(repoDir, ['config', 'user.name', 'Maestro Test'])
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# M13 App\n')
    await git(repoDir, ['add', '.'])
    await git(repoDir, ['commit', '-m', 'init'])

    await engine.worktrees.registerRepo(repoDir)
    repoName = path.basename(repoDir)
    const ws = await engine.worktrees.createWorkspace({ repoPath: repoDir, name: 'usage probe' })

    console.log('=== Running two fake agent turns ===')
    await runTurn(ws.id)
    await runTurn(ws.id)

    console.log('\n=== 1+2: rows persisted + push events broadcast ===')
    assert(pushed.length === 2, `Expected 2 usage_recorded push events, got ${pushed.length}`)
    const rows = engine.usageEvents.listByWorkspace(ws.id)
    assert(rows.length === 2, `Expected 2 usage rows, got ${rows.length}`)
    // listByWorkspace is newest-first; TURNS is oldest-first.
    const [turn2, turn1] = rows
    const expect1 = TURNS[0]
    const expect2 = TURNS[1]
    assert(turn1 !== undefined && turn2 !== undefined && expect1 !== undefined && expect2 !== undefined, 'missing rows')
    assert(turn1.inputTokens === expect1.inputTokens, 'turn1 inputTokens mismatch')
    assert(turn1.outputTokens === expect1.outputTokens, 'turn1 outputTokens mismatch')
    assert(turn1.cacheReadTokens === expect1.cacheReadTokens, 'turn1 cacheReadTokens mismatch')
    assert(turn1.cacheCreationTokens === expect1.cacheCreationTokens, 'turn1 cacheCreationTokens mismatch')
    assert(turn1.cliCostUsd !== null && approxEqual(turn1.cliCostUsd, 0.1234), 'turn1 cliCostUsd mismatch')
    assert(turn1.model === 'claude-sonnet-4-20250514', 'turn1 model mismatch')
    assert(turn2.inputTokens === expect2.inputTokens, 'turn2 inputTokens mismatch')
    assert(turn2.cliCostUsd === null, 'turn2 should have no CLI cost')
    const pushedIds = new Set(pushed.map((e) => e.id))
    assert(rows.every((r) => pushedIds.has(r.id)), 'push events must match stored rows')

    console.log('=== 3: workspace filtering ===')
    engine.usageEvents.record({
      workspaceId: 'other-workspace',
      model: 'claude-opus-4',
      inputTokens: 999,
      outputTokens: 999,
      cacheCreationTokens: 0,
      cacheReadTokens: 0
    })
    assert(engine.usageEvents.listByWorkspace(ws.id).length === 2, 'filter leaked other workspace rows')
    assert(engine.usageEvents.listAll().length === 3, 'listAll should see all rows')
    assert(engine.usageEvents.listAll(1).length === 1, 'listAll limit not applied')

    console.log('=== 4: cost summary math ===')
    const summary = summarizeUsage(engine.usageEvents.listByWorkspace(ws.id), DEFAULT_PRICING)
    const derivedTurn2 = computeCostUsd(turn2, DEFAULT_PRICING)
    assert(derivedTurn2 !== null, 'turn2 model should resolve via prefix match')
    assert(summary.eventCount === 2, 'summary eventCount mismatch')
    assert(summary.inputTokens === expect1.inputTokens! + expect2.inputTokens!, 'summary inputTokens mismatch')
    assert(summary.costComplete, 'summary should be cost-complete')
    assert(approxEqual(summary.totalCostUsd, 0.1234 + derivedTurn2), 'summary total must be cliCost(turn1) + derived(turn2)')

    console.log('=== 5: restart persistence ===')
    engine.close()
    engine = createEngine(dbPath)
    const afterRestart = engine.usageEvents.listByWorkspace(ws.id)
    assert(afterRestart.length === 2, 'usage rows must survive restart')

    console.log({
      turn1: { in: turn1.inputTokens, out: turn1.outputTokens, cliCost: turn1.cliCostUsd },
      turn2: { in: turn2.inputTokens, out: turn2.outputTokens, derivedCost: derivedTurn2 },
      summary: { totalCostUsd: summary.totalCostUsd, costComplete: summary.costComplete }
    })
    console.log('\nMODULE 13 SMOKE TEST PASSED ✅')
  } finally {
    unsubscribe()
    supervisor.cancelAll()
    engine.close()
    try {
      fs.rmSync(repoDir, { recursive: true, force: true })
      fs.rmSync(dbPath, { force: true })
      fs.rmSync(`${dbPath}-wal`, { force: true })
      fs.rmSync(`${dbPath}-shm`, { force: true })
      if (repoName) fs.rmSync(path.join(workspacesRoot(), repoName), { recursive: true, force: true })
    } catch {
      // ignore cleanup failures
    }
  }
}

main().catch((err: unknown) => {
  console.error('\nMODULE 13 SMOKE TEST FAILED ❌')
  console.error(err)
  process.exitCode = 1
})
