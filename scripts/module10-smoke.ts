/**
 * Module 10 acceptance script — in-worktree test runner + comparison data.
 *
 * No live agent CLI needed; the TestRunner runs real shell commands (via
 * `node -e`, cross-platform) against temp worktrees.
 *
 *   Part A — TestRunner: pass / fail (captures stderr) / output echo /
 *            not-configured error / timeout.
 *   Part B — Persistence: setTestCommand round-trip + clear + upsert preserve.
 *   Part C — Comparison data: per-worktree test results differ; per-variant
 *            getDiff file counts; archiveGroupExcept keeps the winner.
 *
 * Run: `npm run smoke:m10` (needs the Node ABI — `npm run rebuild:node`).
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import execa from 'execa'
import { createEngine } from '../src/main/engine'
import { workspacesRoot } from '../src/main/engine/util/paths'
import type { MaestroErrorCode } from '@shared/types'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`)
}

function errCode(err: unknown): MaestroErrorCode | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    return (err as { code?: MaestroErrorCode }).code
  }
  return undefined
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execa('git', args, { cwd, env: { ...process.env, GIT_PAGER: 'cat' } })
}

async function setupRepo(tag: string): Promise<{ repoDir: string; dbPath: string }> {
  const tempBase = path.join(os.tmpdir(), 'maestro test repos')
  fs.mkdirSync(tempBase, { recursive: true })
  const repoDir = path.join(tempBase, `m10 ${tag} ${Date.now()}`)
  fs.mkdirSync(repoDir, { recursive: true })
  await git(repoDir, ['init', '-b', 'main'])
  await git(repoDir, ['config', 'user.email', 'test@maestro.local'])
  await git(repoDir, ['config', 'user.name', 'Maestro Test'])
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# M10\n')
  await git(repoDir, ['add', '.'])
  await git(repoDir, ['commit', '-m', 'init'])
  const dbPath = path.join(tempBase, `m10-${tag}-${Date.now()}.db`)
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
  console.log('=== PART A: TestRunner (pass/fail/output/not-configured/timeout) ===')
  const { repoDir, dbPath } = await setupRepo('A')
  const engine = createEngine(dbPath)
  let repoName = ''
  try {
    const repo = await engine.worktrees.registerRepo(repoDir)
    repoName = repo.name
    const ws = await engine.worktrees.createWorkspace({ repoPath: repoDir, name: 'tests' })

    // Not configured yet → typed error.
    let threw: unknown
    try {
      await engine.tests.run(ws.id)
    } catch (e) {
      threw = e
    }
    assert(errCode(threw) === 'TEST_COMMAND_NOT_CONFIGURED', 'unconfigured → TEST_COMMAND_NOT_CONFIGURED')
    console.log('  unconfigured throws TEST_COMMAND_NOT_CONFIGURED')

    // Passing.
    engine.repos.setTestCommand(repoDir, 'node -e "process.exit(0)"')
    let r = await engine.tests.run(ws.id)
    assert(r.ok && r.exitCode === 0 && !r.timedOut, 'passing command → ok')
    assert(r.command === 'node -e "process.exit(0)"', 'result echoes the command')
    console.log(`  pass: ok=${r.ok} exit=${r.exitCode} ${r.durationMs}ms`)

    // Failing + stderr captured.
    engine.repos.setTestCommand(repoDir, 'node -e "console.error(\'boom\'); process.exit(3)"')
    r = await engine.tests.run(ws.id)
    assert(!r.ok && r.exitCode === 3, 'failing command → exit 3')
    assert(r.output.includes('boom'), 'stderr captured in output')
    console.log(`  fail: ok=${r.ok} exit=${r.exitCode}, stderr captured`)

    // Stdout captured.
    engine.repos.setTestCommand(repoDir, 'node -e "console.log(\'hello-tests\')"')
    r = await engine.tests.run(ws.id)
    assert(r.ok && r.output.includes('hello-tests'), 'stdout captured')
    console.log('  stdout captured')

    // Timeout (per-run override keeps it fast).
    engine.repos.setTestCommand(repoDir, 'node -e "setTimeout(()=>{}, 10000)"')
    r = await engine.tests.run(ws.id, { timeoutMs: 300 })
    assert(r.timedOut && !r.ok, 'long command → timedOut')
    console.log(`  timeout: timedOut=${r.timedOut} after ${r.durationMs}ms`)

    console.log('Part A passed ✅\n')
  } finally {
    engine.close()
    cleanup(repoDir, dbPath, repoName)
  }
}

async function partB(): Promise<void> {
  console.log('=== PART B: persistence (round-trip / clear / upsert preserve) ===')
  const { repoDir, dbPath } = await setupRepo('B')
  const engine = createEngine(dbPath)
  let repoName = ''
  try {
    const repo = await engine.worktrees.registerRepo(repoDir)
    repoName = repo.name

    engine.repos.setTestCommand(repoDir, 'pnpm test')
    assert(engine.repos.get(repoDir)?.testCommand === 'pnpm test', 'testCommand round-trips')

    // Re-registering (upsert) must preserve the test command.
    await engine.worktrees.registerRepo(repoDir)
    assert(engine.repos.get(repoDir)?.testCommand === 'pnpm test', 'upsert preserves testCommand')

    engine.repos.setTestCommand(repoDir, null)
    assert(engine.repos.get(repoDir)?.testCommand === null, 'null clears testCommand')
    console.log('  round-trip + upsert-preserve + clear all hold')

    console.log('Part B passed ✅\n')
  } finally {
    engine.close()
    cleanup(repoDir, dbPath, repoName)
  }

  // Migration idempotency: opening the same DB twice must not throw.
  const { repoDir: rd2, dbPath: db2 } = await setupRepo('B2')
  try {
    const e1 = createEngine(db2)
    e1.close()
    const e2 = createEngine(db2)
    e2.close()
    console.log('  migration idempotent (opened same DB twice)')
  } finally {
    cleanup(rd2, db2, '')
  }
}

async function partC(): Promise<void> {
  console.log('=== PART C: comparison data (per-worktree results + diff counts) ===')
  const { repoDir, dbPath } = await setupRepo('C')
  const engine = createEngine(dbPath)
  let repoName = ''
  try {
    const repo = await engine.worktrees.registerRepo(repoDir)
    repoName = repo.name

    const variants = await engine.worktrees.createFanOut({
      repoPath: repoDir,
      name: 'feature',
      prompt: 'build it',
      variants: [{ agentType: 'claude-code' }, { agentType: 'claude-code' }]
    })
    const [v1, v2] = variants
    assert(v1 !== undefined && v2 !== undefined, 'two variants created')

    // Give v1 a PASS marker + an extra changed file; leave v2 without.
    fs.writeFileSync(path.join(v1!.worktreePath, 'PASS'), '')
    fs.writeFileSync(path.join(v1!.worktreePath, 'extra.txt'), 'v1 only\n')

    // Per-repo command checks for the marker file in the cwd (worktree).
    engine.repos.setTestCommand(
      repoDir,
      'node -e "process.exit(require(\'fs\').existsSync(\'PASS\')?0:1)"'
    )
    const r1 = await engine.tests.run(v1!.id)
    const r2 = await engine.tests.run(v2!.id)
    assert(r1.ok, 'variant with PASS marker passes')
    assert(!r2.ok, 'variant without PASS marker fails')
    console.log(`  per-worktree results differ: v1 ok=${r1.ok}, v2 ok=${r2.ok}`)

    // Per-variant diff counts (the comparison cards' data).
    const d1 = await engine.worktrees.getDiff(v1!.id)
    const d2 = await engine.worktrees.getDiff(v2!.id)
    assert(d1.files.length > d2.files.length, 'v1 shows more changed files than v2')
    console.log(`  getDiff counts: v1=${d1.files.length}, v2=${d2.files.length}`)

    // Keep the winner.
    await engine.worktrees.archiveGroupExcept(v1!.groupId!, v1!.id)
    const remaining = engine.workspaces.listByGroup(v1!.groupId!)
    assert(remaining.length === 1 && remaining[0]!.id === v1!.id, 'only the winner remains')
    console.log('  archiveGroupExcept kept the winner')

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
  console.log('MODULE 10 SMOKE TEST PASSED ✅')
}

main().catch((err: unknown) => {
  console.error('\nMODULE 10 SMOKE TEST FAILED ❌')
  console.error(err)
  process.exitCode = 1
})
