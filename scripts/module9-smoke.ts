/**
 * Module 9 acceptance script — Fan-out & Task Queue.
 *
 * No live agent CLI needed: the supervisor is driven by a FAKE harness that
 * completes each turn after a short delay, so we can assert orchestration
 * behavior deterministically.
 *
 *   Part A — Fan-out (engine): createFanOut makes N variants sharing one
 *            groupId; archiveGroupExcept archives exactly the losers.
 *   Part B — Queue sequential: 3 jobs on ONE workspace run FIFO, one at a time.
 *   Part C — Queue chaining: a job for B depending on A starts only after A
 *            finishes; queue_changed fires and the queue drains to empty.
 *
 * Run: `npm run smoke:m9` (needs the Node ABI — `npm run rebuild:node`).
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import execa from 'execa'
import { createEngine } from '../src/main/engine'
import { WorkspaceSupervisor, type HarnessFactory } from '../src/main/engine/WorkspaceSupervisor'
import { workspacesRoot } from '../src/main/engine/util/paths'
import type { AgentEvent, WorkspacePushEvent } from '@shared/types'
import type { Harness, LaunchOptions } from '../src/main/harness'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`)
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execa('git', args, { cwd, env: { ...process.env, GIT_PAGER: 'cat' } })
}

async function waitUntil(pred: () => boolean, timeoutMs = 4000, label = 'condition'): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

/**
 * Records run order + peak concurrency across all instances. The factory hands
 * every run the same recorder so the test can observe scheduling.
 */
class RunRecorder {
  readonly startOrder: string[] = [] // worktreePaths in start order
  active = 0
  peak = 0
}

/** Fake harness: emits session_started + turn_complete after `delayMs`. */
function fakeFactory(rec: RunRecorder, delayMs = 40): HarnessFactory {
  return () =>
    ({
      type: 'claude-code',
      isAvailable: () => Promise.resolve(true),
      cancel: () => {},
      async run(opts: LaunchOptions, onEvent: (e: AgentEvent) => void): Promise<{ sessionId: string }> {
        rec.startOrder.push(opts.worktreePath)
        rec.active++
        rec.peak = Math.max(rec.peak, rec.active)
        onEvent({ kind: 'session_started', sessionId: 'fake-session' })
        await new Promise((r) => setTimeout(r, delayMs))
        onEvent({ kind: 'turn_complete', sessionId: 'fake-session' })
        rec.active--
        return { sessionId: 'fake-session' }
      }
    }) satisfies Harness
}

async function setupRepo(tag: string): Promise<{ repoDir: string; dbPath: string }> {
  const tempBase = path.join(os.tmpdir(), 'maestro test repos')
  fs.mkdirSync(tempBase, { recursive: true })
  const repoDir = path.join(tempBase, `m9 ${tag} ${Date.now()}`)
  fs.mkdirSync(repoDir, { recursive: true })
  await git(repoDir, ['init', '-b', 'main'])
  await git(repoDir, ['config', 'user.email', 'test@maestro.local'])
  await git(repoDir, ['config', 'user.name', 'Maestro Test'])
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# M9\n')
  await git(repoDir, ['add', '.'])
  await git(repoDir, ['commit', '-m', 'init'])
  const dbPath = path.join(tempBase, `m9-${tag}-${Date.now()}.db`)
  return { repoDir, dbPath }
}

function cleanup(repoDir: string, dbPath: string, repoName: string): void {
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

// PLACEHOLDER_PARTS

async function partA(): Promise<void> {
  console.log('=== PART A: fan-out (engine) ===')
  const { repoDir, dbPath } = await setupRepo('A')
  const engine = createEngine(dbPath)
  let repoName = ''
  try {
    const repo = await engine.worktrees.registerRepo(repoDir)
    repoName = repo.name

    const variants = await engine.worktrees.createFanOut({
      repoPath: repoDir,
      name: 'login page',
      prompt: 'build a login page',
      variants: [{ agentType: 'claude-code' }, { agentType: 'claude-code', model: 'opus' }]
    })
    assert(variants.length === 2, 'fan-out creates 2 variants')
    const gid = variants[0]!.groupId
    assert(gid !== null, 'variant has a groupId')
    assert(variants.every((v) => v.groupId === gid), 'all variants share one groupId')
    assert(variants[0]!.branch !== variants[1]!.branch, 'variants get distinct branches')
    console.log(`  created group ${gid} with ${variants.length} variants`)

    // Keep variant 0, archive the rest.
    await engine.worktrees.archiveGroupExcept(gid!, variants[0]!.id)
    const remaining = engine.workspaces.listByGroup(gid!)
    assert(remaining.length === 1 && remaining[0]!.id === variants[0]!.id, 'only the winner remains')
    console.log('  archiveGroupExcept kept the winner, archived the loser')
    console.log('Part A passed ✅\n')
  } finally {
    engine.close()
    cleanup(repoDir, dbPath, repoName)
  }
}

async function partB(): Promise<void> {
  console.log('=== PART B: queue sequential (one workspace, FIFO) ===')
  const { repoDir, dbPath } = await setupRepo('B')
  const rec = new RunRecorder()
  const engine = createEngine(dbPath)
  const supervisor = new WorkspaceSupervisor(engine, undefined, fakeFactory(rec))
  const queueEvents: WorkspacePushEvent[] = []
  supervisor.subscribe((e) => queueEvents.push(e))
  let repoName = ''
  try {
    const repo = await engine.worktrees.registerRepo(repoDir)
    repoName = repo.name
    const ws = await engine.worktrees.createWorkspace({ repoPath: repoDir, name: 'seq' })

    // Enqueue 3 jobs on the SAME workspace. First runs immediately; the rest
    // wait because the workspace is busy.
    await supervisor.enqueue({ workspaceId: ws.id, prompt: 'step 1' })
    await supervisor.enqueue({ workspaceId: ws.id, prompt: 'step 2' })
    await supervisor.enqueue({ workspaceId: ws.id, prompt: 'step 3' })

    await waitUntil(
      () => rec.startOrder.length === 3 && supervisor.listQueue().length === 0,
      6000,
      '3 runs'
    )
    assert(rec.peak === 1, `same-workspace jobs never overlap (peak=${rec.peak})`)
    assert(rec.startOrder.length === 3, 'all 3 jobs ran')
    assert(
      queueEvents.some((e) => e.type === 'queue_changed'),
      'queue_changed events fired'
    )
    assert(supervisor.listQueue().length === 0, 'queue drained to empty')
    console.log(`  3 sequential jobs ran one-at-a-time (peak concurrency ${rec.peak})`)
    console.log('Part B passed ✅\n')
  } finally {
    engine.close()
    cleanup(repoDir, dbPath, repoName)
  }
}

async function partC(): Promise<void> {
  console.log('=== PART C: queue chaining (B waits for A) ===')
  const { repoDir, dbPath } = await setupRepo('C')
  const rec = new RunRecorder()
  const engine = createEngine(dbPath)
  const supervisor = new WorkspaceSupervisor(engine, undefined, fakeFactory(rec, 60))
  let repoName = ''
  try {
    const repo = await engine.worktrees.registerRepo(repoDir)
    repoName = repo.name
    const a = await engine.worktrees.createWorkspace({ repoPath: repoDir, name: 'A' })
    const b = await engine.worktrees.createWorkspace({ repoPath: repoDir, name: 'B' })

    // Start A, then enqueue B depending on A while A is still running.
    await supervisor.enqueue({ workspaceId: a.id, prompt: 'do A' })
    await waitUntil(() => rec.startOrder.includes(a.worktreePath), 4000, 'A started')
    await supervisor.enqueue({ workspaceId: b.id, prompt: 'do B', dependsOnWorkspaceId: a.id })

    // While A runs, B must NOT have started.
    assert(!rec.startOrder.includes(b.worktreePath), 'B does not start while A is running')

    await waitUntil(() => rec.startOrder.includes(b.worktreePath), 6000, 'B started')
    const ai = rec.startOrder.indexOf(a.worktreePath)
    const bi = rec.startOrder.indexOf(b.worktreePath)
    assert(ai !== -1 && bi !== -1 && ai < bi, 'A ran before B')
    await waitUntil(() => supervisor.listQueue().length === 0, 4000, 'queue empty')
    const aWs = engine.workspaces.getById(a.id)
    assert(aWs?.status === 'awaiting_input', 'A reached awaiting_input before B ran')
    console.log('  B started only after A finished; queue drained')
    console.log('Part C passed ✅\n')
  } finally {
    engine.close()
    cleanup(repoDir, dbPath, repoName)
  }
}

async function main(): Promise<void> {
  await partA()
  await partB()
  await partC()
  console.log('MODULE 9 SMOKE TEST PASSED ✅')
}

main().catch((err: unknown) => {
  console.error('\nMODULE 9 SMOKE TEST FAILED ❌')
  console.error(err)
  process.exitCode = 1
})
