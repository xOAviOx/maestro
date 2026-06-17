/**
 * Module 1 acceptance script (no UI).
 *
 * Runs the full create -> list -> diff -> archive cycle against a real, throwaway
 * git repo. To exercise the cross-platform requirements from the brief, the
 * source repo lives under a path containing a SPACE (and thus the worktree path
 * does too). Run with: `npm run smoke:m1`.
 */
import execa from 'execa'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createEngine } from '../src/main/engine'
import { WorkspaceDirtyError } from '../src/main/engine/errors'
import { workspacesRoot } from '../src/main/engine/util/paths'

function log(title: string, value?: unknown): void {
  if (value === undefined) {
    console.log(`\n=== ${title} ===`)
  } else {
    console.log(`\n=== ${title} ===\n${JSON.stringify(value, null, 2)}`)
  }
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execa('git', args, { cwd, env: { ...process.env, GIT_PAGER: 'cat' } })
}

async function main(): Promise<void> {
  // Temp area with a space in the path (cross-platform correctness check).
  const tempBase = path.join(os.tmpdir(), 'maestro test repos')
  fs.mkdirSync(tempBase, { recursive: true })
  const repoDir = path.join(tempBase, `sample app ${Date.now()}`)
  fs.mkdirSync(repoDir, { recursive: true })
  const dbPath = path.join(tempBase, `m1-${Date.now()}.db`)

  const engine = createEngine(dbPath)
  let createdRepoName = ''

  try {
    // --- Set up a real repo with an initial commit on `main`. ---
    await git(repoDir, ['init', '-b', 'main'])
    await git(repoDir, ['config', 'user.email', 'test@maestro.local'])
    await git(repoDir, ['config', 'user.name', 'Maestro Test'])
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# Sample App\n\nHello.\n')
    fs.writeFileSync(path.join(repoDir, '.gitignore'), '.env.local\n')
    // A gitignored file that should be copied into worktrees once configured.
    fs.writeFileSync(path.join(repoDir, '.env.local'), 'SECRET=local-only\n')
    await git(repoDir, ['add', 'README.md', '.gitignore'])
    await git(repoDir, ['commit', '-m', 'initial commit'])
    log('Created throwaway repo (note the space in the path)', { repoDir, dbPath })

    // --- Register the repo. ---
    const repoInfo = await engine.worktrees.registerRepo(repoDir)
    createdRepoName = repoInfo.name
    log('registerRepo -> RepoInfo', repoInfo)

    // Configure files-to-copy so .env.local lands in new worktrees.
    engine.repos.setFilesToCopy(repoInfo.path, ['.env.local'])

    // --- Create a workspace. ---
    const ws = await engine.worktrees.createWorkspace({
      repoPath: repoDir,
      name: 'Add greeting',
      agentType: 'claude-code'
    })
    log('createWorkspace -> Workspace', ws)

    // Confirm worktree exists and the gitignored file was copied in.
    const worktreeExists = fs.existsSync(ws.worktreePath)
    const envCopied = fs.existsSync(path.join(ws.worktreePath, '.env.local'))
    log('Worktree on disk?', { worktreePath: ws.worktreePath, worktreeExists, envCopied })

    // --- Make changes in the worktree: committed + uncommitted + untracked. ---
    // 1) committed new file
    fs.writeFileSync(path.join(ws.worktreePath, 'feature.txt'), 'a committed feature\n')
    await git(ws.worktreePath, ['add', 'feature.txt'])
    await git(ws.worktreePath, ['commit', '-m', 'add feature.txt'])
    // 2) uncommitted modification of a tracked file
    fs.appendFileSync(path.join(ws.worktreePath, 'README.md'), '\nEdited by the agent.\n')
    // 3) untracked new file
    fs.writeFileSync(path.join(ws.worktreePath, 'notes.txt'), 'scratch notes\n')

    // --- List + reconcile. ---
    const list = await engine.worktrees.listWorkspaces(repoDir)
    log('listWorkspaces', list.map((w) => ({ id: w.id, name: w.name, branch: w.branch, status: w.status })))

    // --- Diff against base. ---
    const diff = await engine.worktrees.getDiff(ws.id)
    log('getDiff -> files', diff.files)
    log('getDiff -> patch', diff.patch)

    // --- Archive: first refuse while dirty, then force. ---
    let refused = false
    try {
      await engine.worktrees.archiveWorkspace(ws.id, false)
    } catch (err) {
      if (err instanceof WorkspaceDirtyError) {
        refused = true
        log('archiveWorkspace(force=false) correctly refused dirty worktree', { message: err.message })
      } else {
        throw err
      }
    }
    if (!refused) throw new Error('Expected archive to refuse a dirty worktree without force')

    await engine.worktrees.archiveWorkspace(ws.id, true)
    const stillThere = fs.existsSync(ws.worktreePath)
    const listAfter = await engine.worktrees.listWorkspaces(repoDir)
    log('After archive(force=true)', {
      worktreeRemoved: !stillThere,
      activeWorkspaces: listAfter.length
    })

    if (stillThere) throw new Error('Worktree directory was not removed on archive')
    if (listAfter.length !== 0) throw new Error('Expected no active workspaces after archive')

    log('MODULE 1 SMOKE TEST PASSED ✅')
  } finally {
    engine.close()
    // Best-effort cleanup of temp repo, temp db, and the worktree parent dir.
    try {
      fs.rmSync(repoDir, { recursive: true, force: true })
      fs.rmSync(dbPath, { force: true })
      fs.rmSync(`${dbPath}-wal`, { force: true })
      fs.rmSync(`${dbPath}-shm`, { force: true })
      if (createdRepoName) {
        fs.rmSync(path.join(workspacesRoot(), createdRepoName), { recursive: true, force: true })
      }
    } catch {
      // ignore cleanup failures
    }
  }
}

main().catch((err: unknown) => {
  console.error('\nMODULE 1 SMOKE TEST FAILED ❌')
  console.error(err)
  process.exitCode = 1
})
