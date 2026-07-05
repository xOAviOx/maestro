/**
 * Module 12 acceptance script (no UI) — the DAG scheduler.
 *
 * Runs a scripted 4-task DIAMOND workflow (A -> B, A -> C, B -> D, C -> D)
 * head­lessly against a real throwaway git repo, using a MOCK agent (sleep, then
 * write+commit a file) in place of Claude Code but the REAL WorktreeManager for
 * worktree creation and merges. It verifies:
 *   - correct dependency ordering (D spawns only after BOTH B and C merge),
 *   - D's worktree forks from a base containing B's and C's merged changes,
 *   - merges are serialized (never two at once),
 *   - the concurrency cap is respected (B and C run in parallel, cap not exceeded),
 *   - the base branch ends up with every task's file.
 *
 * The source repo path contains a SPACE (cross-platform correctness), matching
 * the other module smokes. Run with `npm run smoke:m12` (needs the Node ABI —
 * `npm run rebuild:node` first, since it touches better-sqlite3).
 */
import execa from 'execa'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createEngine } from '../src/main/engine'
import { WorkflowScheduler } from '../src/main/engine/scheduler/WorkflowScheduler'
import type { TaskRunner } from '../src/main/engine/scheduler/TaskRunner'
import { workspacesRoot } from '../src/main/engine/util/paths'
import type { NewTaskInput, Task, Workflow } from '../shared/types'

function log(title: string, value?: unknown): void {
  if (value === undefined) console.log(`\n=== ${title} ===`)
  else console.log(`\n=== ${title} ===\n${JSON.stringify(value, null, 2)}`)
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execa('git', args, { cwd, env: { ...process.env, GIT_PAGER: 'cat' } })
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(cond: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (cond()) return
    await wait(15)
  }
  throw new Error(`Timed out waiting for: ${label}`)
}

const DIAMOND: NewTaskInput[] = [
  { id: 'a', title: 'A', prompt: 'do A', dependsOn: [] },
  { id: 'b', title: 'B', prompt: 'do B', dependsOn: ['a'] },
  { id: 'c', title: 'C', prompt: 'do C', dependsOn: ['a'] },
  { id: 'd', title: 'D', prompt: 'do D', dependsOn: ['b', 'c'] }
]

async function main(): Promise<void> {
  const tempBase = path.join(os.tmpdir(), 'maestro test repos')
  fs.mkdirSync(tempBase, { recursive: true })
  const repoDir = path.join(tempBase, `dag app ${Date.now()}`)
  fs.mkdirSync(repoDir, { recursive: true })
  const dbPath = path.join(tempBase, `m9-${Date.now()}.db`)

  const engine = createEngine(dbPath)
  let createdRepoName = ''

  // Instrumentation collected from the mock runner + scheduler snapshots.
  const spawnOrder: string[] = []
  const mergeOrder: string[] = []
  // Peak number of tasks simultaneously in `running` STATUS, sampled from the
  // scheduler's own snapshots — deterministic, unlike a wall-clock overlap race
  // (real `git worktree add` latency can dwarf a mock agent's think time).
  let peakConcurrency = 0
  let mergeInFlight = false
  let dWorktreeFiles: string[] = []

  try {
    // --- Real repo on `main` with an initial commit. ---
    await git(repoDir, ['init', '-b', 'main'])
    await git(repoDir, ['config', 'user.email', 'test@maestro.local'])
    await git(repoDir, ['config', 'user.name', 'Maestro Test'])
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# DAG sample\n')
    await git(repoDir, ['add', 'README.md'])
    await git(repoDir, ['commit', '-m', 'initial commit'])
    const repoInfo = await engine.worktrees.registerRepo(repoDir)
    createdRepoName = repoInfo.name
    log('Throwaway repo (note the space in the path)', { repoDir, dbPath })

    // The scheduler is referenced by the mock runner's deferred completion, so it
    // is declared first and assigned below (the timer fires well after).
    let scheduler!: WorkflowScheduler

    // Mock agent: create a REAL worktree, then after a short "think" write+commit
    // one file and report completion, then auto-approve (merge) the task — which
    // is what unblocks its children.
    async function runAgent(task: Task, workflow: Workflow, workspaceId: string): Promise<void> {
      const ws = await engine.worktrees.getWorkspace(workspaceId)
      fs.writeFileSync(path.join(ws.worktreePath, `${task.id}.txt`), `work by ${task.id}\n`)
      await git(ws.worktreePath, ['add', '.'])
      await git(ws.worktreePath, ['commit', '-m', `agent ${task.id}`])
      if (task.id === 'd') dWorktreeFiles = fs.readdirSync(ws.worktreePath)

      scheduler.onAgentCompleted(workspaceId)
      await scheduler.approveTask(workflow.id, task.id) // user approves -> merge
    }

    const runner: TaskRunner = {
      async spawnAgent(task: Task, workflow: Workflow): Promise<{ workspaceId: string }> {
        const ws = await engine.worktrees.createWorkspace({
          repoPath: workflow.repoPath,
          name: task.title,
          baseBranch: workflow.baseBranch,
          agentType: 'claude-code'
        })
        spawnOrder.push(task.id)
        // "Think" asynchronously so siblings overlap (exercises concurrency).
        setTimeout(() => {
          void runAgent(task, workflow, ws.id).catch((err) => {
            console.error('mock agent failed', err)
          })
        }, 25)
        return { workspaceId: ws.id }
      },
      async mergeTask(task: Task): Promise<void> {
        if (mergeInFlight) throw new Error('CONCURRENT MERGE DETECTED — queue not serial!')
        if (!task.agentId) throw new Error(`task ${task.id} has no workspace`)
        mergeInFlight = true
        try {
          await engine.worktrees.mergeWorkspace(task.agentId, {
            commitMessage: `merge ${task.id}`,
            archiveAfter: false
          })
        } finally {
          mergeInFlight = false
        }
        mergeOrder.push(task.id)
      },
      async discardTask(): Promise<void> {
        // no-op for the happy-path smoke
      }
    }

    scheduler = new WorkflowScheduler({
      store: engine.workflows,
      runner,
      resolveBaseBranch: (rp) => engine.git.getDefaultBaseBranch(rp),
      emit: (wf) => {
        const running = wf.tasks.filter((t) => t.status === 'running').length
        peakConcurrency = Math.max(peakConcurrency, running)
      }
    })

    // --- Create + run the diamond. ---
    const wf = await scheduler.createWorkflow({
      name: 'diamond',
      repoPath: repoDir,
      baseBranch: 'main',
      maxConcurrency: 3,
      tasks: DIAMOND
    })
    log('createWorkflow -> tasks', wf.tasks.map((t) => ({ id: t.id, status: t.status })))

    await scheduler.startWorkflow(wf.id)
    await waitFor(
      () => scheduler.getWorkflow(wf.id).status === 'completed',
      10_000,
      'workflow to complete'
    )

    const final = scheduler.getWorkflow(wf.id)
    log('Final task statuses', final.tasks.map((t) => ({ id: t.id, status: t.status })))
    log('Spawn order', spawnOrder)
    log('Merge order', mergeOrder)
    log('Peak concurrency', peakConcurrency)
    log("D's worktree contents", dWorktreeFiles)

    // --- Assertions. ---
    const check = (ok: boolean, msg: string): void => {
      if (!ok) throw new Error(`ASSERTION FAILED: ${msg}`)
    }

    check(
      final.tasks.every((t) => t.status === 'merged'),
      'every task should end merged'
    )
    check(final.status === 'completed', 'workflow should be completed')

    // Ordering: D spawns after BOTH B and C merged.
    check(spawnOrder[0] === 'a', 'A should spawn first')
    check(
      spawnOrder.indexOf('d') > spawnOrder.indexOf('b') &&
        spawnOrder.indexOf('d') > spawnOrder.indexOf('c'),
      'D must spawn after B and C'
    )
    check(
      mergeOrder.indexOf('d') === mergeOrder.length - 1,
      'D must be the last task merged'
    )

    // Fresh-base guarantee: D's worktree forked from a base with B's and C's work.
    check(dWorktreeFiles.includes('b.txt'), "D's worktree should contain B's file")
    check(dWorktreeFiles.includes('c.txt'), "D's worktree should contain C's file")
    check(dWorktreeFiles.includes('d.txt'), "D's worktree should contain its own file")

    // Concurrency: B and C ran in parallel, but the cap (3) was never exceeded.
    check(peakConcurrency >= 2, 'B and C should have run concurrently (peak >= 2)')
    check(peakConcurrency <= 3, 'concurrency cap (3) must never be exceeded')

    // Base branch ends up with every task's file (merges landed on main).
    for (const id of ['a', 'b', 'c', 'd']) {
      check(fs.existsSync(path.join(repoDir, `${id}.txt`)), `main should contain ${id}.txt`)
    }

    log('MODULE 12 SMOKE TEST PASSED ✅')
  } finally {
    engine.close()
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
  console.error('\nMODULE 12 SMOKE TEST FAILED ❌')
  console.error(err)
  process.exitCode = 1
})
