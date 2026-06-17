/**
 * Module 5 acceptance script (engine side of the diff).
 *
 * Proves getDiff + getFileDiff return ACCURATE base-vs-worktree content for the
 * three interesting cases — modified, added, deleted — so the Monaco diff editor
 * has correct data to render. (The visual rendering is verified live in the app.)
 *
 * Runs under plain Node/tsx — run `npm run rebuild:node` first if you've been
 * running the Electron app. Run: `npm run smoke:m5`.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import assert from 'assert'
import execa from 'execa'
import { createEngine } from '../src/main/engine'
import { workspacesRoot } from '../src/main/engine/util/paths'

async function git(cwd: string, args: string[]): Promise<void> {
  await execa('git', args, { cwd, env: { ...process.env, GIT_PAGER: 'cat' } })
}

async function main(): Promise<void> {
  const tempBase = path.join(os.tmpdir(), 'maestro test repos')
  fs.mkdirSync(tempBase, { recursive: true })
  const repoDir = path.join(tempBase, `m5 app ${Date.now()}`)
  fs.mkdirSync(repoDir, { recursive: true })
  const dbPath = path.join(tempBase, `m5-${Date.now()}.db`)
  const engine = createEngine(dbPath)
  let repoName = ''

  try {
    await git(repoDir, ['init', '-b', 'main'])
    await git(repoDir, ['config', 'user.email', 'test@maestro.local'])
    await git(repoDir, ['config', 'user.name', 'Maestro Test'])
    fs.writeFileSync(path.join(repoDir, 'keep.txt'), 'line1\nline2\nline3\n')
    fs.writeFileSync(path.join(repoDir, 'remove.txt'), 'delete me\n')
    await git(repoDir, ['add', '.'])
    await git(repoDir, ['commit', '-m', 'init'])

    await engine.worktrees.registerRepo(repoDir)
    repoName = path.basename(repoDir)
    const ws = await engine.worktrees.createWorkspace({ repoPath: repoDir, name: 'diff demo' })

    // Simulate agent edits in the worktree:
    fs.writeFileSync(path.join(ws.worktreePath, 'keep.txt'), 'line1\nCHANGED\nline3\n') // modified
    fs.writeFileSync(path.join(ws.worktreePath, 'added.txt'), 'brand new file\n') // added (untracked)
    fs.rmSync(path.join(ws.worktreePath, 'remove.txt')) // deleted

    const diff = await engine.worktrees.getDiff(ws.id)
    console.log('Changed files:', diff.files)

    const byPath = new Map(diff.files.map((f) => [f.path, f]))
    assert(byPath.get('keep.txt')?.status === 'modified', 'keep.txt should be modified')
    assert(byPath.get('remove.txt')?.status === 'deleted', 'remove.txt should be deleted')
    assert(byPath.get('added.txt')?.status === 'untracked', 'added.txt should be untracked')

    // --- modified ---
    const keep = await engine.worktrees.getFileDiff(ws.id, 'keep.txt')
    console.log('\nkeep.txt diff:', keep)
    assert.strictEqual(keep.original, 'line1\nline2\nline3\n', 'keep.txt original mismatch')
    assert.strictEqual(keep.modified, 'line1\nCHANGED\nline3\n', 'keep.txt modified mismatch')
    assert(!keep.binary, 'keep.txt should not be binary')

    // --- added ---
    const added = await engine.worktrees.getFileDiff(ws.id, 'added.txt')
    console.log('added.txt diff:', added)
    assert.strictEqual(added.original, '', 'added.txt original should be empty')
    assert.strictEqual(added.modified, 'brand new file\n', 'added.txt modified mismatch')

    // --- deleted ---
    const removed = await engine.worktrees.getFileDiff(ws.id, 'remove.txt')
    console.log('remove.txt diff:', removed)
    assert.strictEqual(removed.original, 'delete me\n', 'remove.txt original mismatch')
    assert.strictEqual(removed.modified, '', 'remove.txt modified should be empty')

    console.log('\nMODULE 5 SMOKE TEST PASSED ✅')
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
  console.error('\nMODULE 5 SMOKE TEST FAILED ❌')
  console.error(err)
  process.exitCode = 1
})
