/**
 * Module 11 acceptance script — persisted review history.
 *
 * Verifies that merge/PR outcomes are recorded and survive, against a real repo:
 *   1) a successful merge records a 'merge' review event (correct branch/base,
 *      committed flag) retrievable via listReviewEvents;
 *   2) a 'pr' event (recorded directly, since gh isn't available in CI) lists
 *      alongside it, newest-first, with its url preserved;
 *   3) history PERSISTS across an engine close/reopen on the same db;
 *   4) history SURVIVES archiving the workspace (the worktree is gone, the
 *      record remains);
 *   5) listReviewEvents on an unknown id throws WorkspaceNotFoundError.
 *
 * Runs under plain Node/tsx — run `npm run rebuild:node` first if you've been
 * running the Electron app. Run: `npm run smoke:m11`.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import assert from 'assert'
import execa from 'execa'
import { createEngine } from '../src/main/engine'
import { WorkspaceNotFoundError } from '../src/main/engine/errors'
import { workspacesRoot } from '../src/main/engine/util/paths'

async function git(cwd: string, args: string[]): Promise<void> {
  await execa('git', args, { cwd, env: { ...process.env, GIT_PAGER: 'cat' } })
}

async function main(): Promise<void> {
  const tempBase = path.join(os.tmpdir(), 'maestro test repos')
  fs.mkdirSync(tempBase, { recursive: true })
  const repoDir = path.join(tempBase, `m8 app ${Date.now()}`)
  fs.mkdirSync(repoDir, { recursive: true })
  const dbPath = path.join(tempBase, `m8-${Date.now()}.db`)
  let engine = createEngine(dbPath)
  let repoName = ''
  let workspaceId = ''

  try {
    await git(repoDir, ['init', '-b', 'main'])
    await git(repoDir, ['config', 'user.email', 'test@maestro.local'])
    await git(repoDir, ['config', 'user.name', 'Maestro Test'])
    fs.writeFileSync(path.join(repoDir, 'foo.txt'), 'hello\n')
    await git(repoDir, ['add', '.'])
    await git(repoDir, ['commit', '-m', 'init'])

    await engine.worktrees.registerRepo(repoDir)
    repoName = path.basename(repoDir)

    // --- (1) merge records a 'merge' event ---
    const ws = await engine.worktrees.createWorkspace({ repoPath: repoDir, name: 'edit foo' })
    workspaceId = ws.id
    fs.writeFileSync(path.join(ws.worktreePath, 'foo.txt'), 'hello world\n') // uncommitted

    const merge = await engine.worktrees.mergeWorkspace(ws.id, { archiveAfter: false })
    assert(merge.merged, 'merge should succeed')

    let history = await engine.worktrees.listReviewEvents(ws.id)
    assert.strictEqual(history.length, 1, 'one event after merge')
    const [mergeEvent] = history
    assert(mergeEvent, 'merge event present')
    assert.strictEqual(mergeEvent.kind, 'merge', 'kind is merge')
    assert.strictEqual(mergeEvent.branch, ws.branch, 'branch recorded')
    assert.strictEqual(mergeEvent.baseBranch, ws.baseBranch, 'base recorded')
    assert.strictEqual(mergeEvent.committed, true, 'auto-commit flag recorded')
    assert.strictEqual(mergeEvent.url, null, 'merge event has no url')
    console.log('✓ merge recorded a review event:', mergeEvent.kind, mergeEvent.branch)

    // --- (2) a 'pr' event lists alongside it, newest-first ---
    engine.reviewEvents.record({
      workspaceId: ws.id,
      repoPath: ws.repoPath,
      kind: 'pr',
      baseBranch: ws.baseBranch,
      branch: ws.branch,
      url: 'https://github.com/example/repo/pull/42',
      committed: false
    })
    history = await engine.worktrees.listReviewEvents(ws.id)
    assert.strictEqual(history.length, 2, 'two events after PR record')
    assert.strictEqual(history[0]?.kind, 'pr', 'newest event (pr) is first')
    assert.strictEqual(
      history[0]?.url,
      'https://github.com/example/repo/pull/42',
      'pr url preserved'
    )
    console.log('✓ pr event lists newest-first with url preserved')

    // --- (3) history persists across an engine close/reopen ---
    engine.close()
    engine = createEngine(dbPath)
    const afterReopen = await engine.worktrees.listReviewEvents(ws.id)
    assert.strictEqual(afterReopen.length, 2, 'history persists across reopen')
    console.log('✓ history survived engine close/reopen')

    // --- (4) history survives archiving the workspace ---
    await engine.worktrees.archiveWorkspace(ws.id)
    assert(!fs.existsSync(ws.worktreePath), 'worktree removed by archive')
    const afterArchive = await engine.worktrees.listReviewEvents(ws.id)
    assert.strictEqual(afterArchive.length, 2, 'history survives archive')
    console.log('✓ history survived archiving the workspace')

    // --- (5) unknown id throws ---
    let threw = false
    try {
      await engine.worktrees.listReviewEvents('00000000-0000-0000-0000-000000000000')
    } catch (err) {
      threw = err instanceof WorkspaceNotFoundError
    }
    assert(threw, 'unknown workspace id should throw WorkspaceNotFoundError')
    console.log('✓ unknown workspace id throws WorkspaceNotFoundError')

    console.log('\nMODULE 11 SMOKE TEST PASSED ✅')
  } finally {
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
    void workspaceId
  }
}

main().catch((err: unknown) => {
  console.error('\nMODULE 11 SMOKE TEST FAILED ❌')
  console.error(err)
  process.exitCode = 1
})
