/**
 * Module 6 acceptance script.
 *
 * Verifies the review → merge/archive flow end-to-end against a real repo:
 *   1) auto-commit uncommitted work + merge a workspace into its base branch,
 *      confirming the change lands on base;
 *   2) a conflicting merge is ABORTED cleanly and reports the conflicted files
 *      (base worktree left untouched) — surfaced, not silently failed;
 *   3) archive removes the worktree.
 *
 * Runs under plain Node/tsx — run `npm run rebuild:node` first if you've been
 * running the Electron app. Run: `npm run smoke:m6`.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import assert from 'assert'
import execa from 'execa'
import { createEngine } from '../src/main/engine'
import { MergeConflictError } from '../src/main/engine/errors'
import { workspacesRoot } from '../src/main/engine/util/paths'

async function git(cwd: string, args: string[]): Promise<void> {
  await execa('git', args, { cwd, env: { ...process.env, GIT_PAGER: 'cat' } })
}
// Normalize line endings — Windows git autocrlf checks out CRLF, which is
// correct product behavior; we compare logical content.
const read = (p: string): string => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

async function main(): Promise<void> {
  const tempBase = path.join(os.tmpdir(), 'maestro test repos')
  fs.mkdirSync(tempBase, { recursive: true })
  const repoDir = path.join(tempBase, `m6 app ${Date.now()}`)
  fs.mkdirSync(repoDir, { recursive: true })
  const dbPath = path.join(tempBase, `m6-${Date.now()}.db`)
  const engine = createEngine(dbPath)
  let repoName = ''

  try {
    await git(repoDir, ['init', '-b', 'main'])
    await git(repoDir, ['config', 'user.email', 'test@maestro.local'])
    await git(repoDir, ['config', 'user.name', 'Maestro Test'])
    fs.writeFileSync(path.join(repoDir, 'foo.txt'), 'hello\n')
    fs.writeFileSync(path.join(repoDir, 'bar.txt'), 'L1\nL2\nL3\n')
    await git(repoDir, ['add', '.'])
    await git(repoDir, ['commit', '-m', 'init'])

    await engine.worktrees.registerRepo(repoDir)
    repoName = path.basename(repoDir)

    // --- (1) happy-path merge with auto-commit ---
    const wsA = await engine.worktrees.createWorkspace({ repoPath: repoDir, name: 'edit foo' })
    fs.writeFileSync(path.join(wsA.worktreePath, 'foo.txt'), 'hello world\n') // uncommitted

    const mergeA = await engine.worktrees.mergeWorkspace(wsA.id, { archiveAfter: false })
    console.log('mergeA:', mergeA)
    assert(mergeA.merged, 'A should merge')
    assert(mergeA.committed, 'A had uncommitted changes that should be auto-committed')
    assert.strictEqual(read(path.join(repoDir, 'foo.txt')), 'hello world\n', 'foo.txt not on base')
    assert.strictEqual((await engine.worktrees.getWorkspace(wsA.id)).status, 'done', 'A not done')
    console.log('✓ happy-path merge landed on base; status=done')

    // --- (2) conflicting merge: create B and C from the SAME base, both editing L2 ---
    const wsB = await engine.worktrees.createWorkspace({ repoPath: repoDir, name: 'bar from b' })
    const wsC = await engine.worktrees.createWorkspace({ repoPath: repoDir, name: 'bar from c' })
    fs.writeFileSync(path.join(wsB.worktreePath, 'bar.txt'), 'L1\nL2-from-B\nL3\n')
    fs.writeFileSync(path.join(wsC.worktreePath, 'bar.txt'), 'L1\nL2-from-C\nL3\n')

    const mergeB = await engine.worktrees.mergeWorkspace(wsB.id, { archiveAfter: false })
    assert(mergeB.merged, 'B should merge cleanly')
    assert.strictEqual(read(path.join(repoDir, 'bar.txt')), 'L1\nL2-from-B\nL3\n', 'B not on base')
    console.log('✓ B merged cleanly')

    let conflicted: string[] | null = null
    try {
      await engine.worktrees.mergeWorkspace(wsC.id, { archiveAfter: false })
    } catch (err) {
      if (err instanceof MergeConflictError) {
        const files = err.details?.['conflictedFiles']
        conflicted = Array.isArray(files) ? (files as string[]) : []
      } else {
        throw err
      }
    }
    assert(conflicted !== null, 'C merge should have raised a MergeConflictError')
    assert(conflicted.includes('bar.txt'), 'bar.txt should be reported conflicted')
    // Base worktree must be left clean (merge aborted) and still at B's version.
    assert(
      !(await engine.git.hasUncommittedChanges(repoDir)),
      'base worktree should be clean after aborted merge'
    )
    assert.strictEqual(
      read(path.join(repoDir, 'bar.txt')),
      'L1\nL2-from-B\nL3\n',
      'aborted merge must not change base'
    )
    console.log('✓ conflicting merge aborted cleanly; reported:', conflicted)

    // --- (3) archive removes the worktree ---
    await engine.worktrees.archiveWorkspace(wsA.id)
    assert(!fs.existsSync(wsA.worktreePath), 'A worktree should be removed after archive')
    console.log('✓ archive removed the worktree')

    console.log('\nMODULE 6 SMOKE TEST PASSED ✅')
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
  }
}

main().catch((err: unknown) => {
  console.error('\nMODULE 6 SMOKE TEST FAILED ❌')
  console.error(err)
  process.exitCode = 1
})
