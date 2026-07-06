/**
 * Module 3 acceptance script.
 *
 * Starts agents in TWO worktrees simultaneously and verifies that the event
 * streams interleave correctly without cross-contamination of files or sessions.
 * Each workspace is told to create a differently-named file with different
 * content; afterward we assert each file exists ONLY in its own worktree, and
 * that the two sessions are distinct.
 *
 * Drives the real Claude Code CLI via the supervisor. Run: `npm run smoke:m3`.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import execa from 'execa'
import { createEngine } from '../src/main/engine'
import { WorkspaceSupervisor } from '../src/main/engine/WorkspaceSupervisor'
import { workspacesRoot } from '../src/main/engine/util/paths'
import { ClaudeCodeHarness } from '../src/main/harness'
import type { WorkspacePushEvent } from '@shared/types'

async function git(cwd: string, args: string[]): Promise<void> {
  await execa('git', args, { cwd, env: { ...process.env, GIT_PAGER: 'cat' } })
}

const TERMINAL = new Set(['awaiting_input', 'error', 'idle', 'done'])

async function main(): Promise<void> {
  if (!(await new ClaudeCodeHarness().isAvailable())) {
    console.log('Claude Code CLI not found on PATH — skipping Module 3 live test.')
    return
  }

  const tempBase = path.join(os.tmpdir(), 'maestro test repos')
  fs.mkdirSync(tempBase, { recursive: true })
  const repoDir = path.join(tempBase, `m3 app ${Date.now()}`)
  fs.mkdirSync(repoDir, { recursive: true })
  const dbPath = path.join(tempBase, `m3-${Date.now()}.db`)
  const engine = createEngine(dbPath)
  const supervisor = new WorkspaceSupervisor(engine)
  let repoName = ''

  // Collect events per workspace + track which workspaces have finished.
  const sessionByWs = new Map<string, string>()
  const finished = new Map<string, string>() // workspaceId -> terminal status
  let resolveAllDone: (() => void) | null = null
  const allDone = new Promise<void>((resolve) => {
    resolveAllDone = resolve
  })

  const labels = new Map<string, string>() // workspaceId -> "A"/"B"
  const unsubscribe = supervisor.subscribe((evt: WorkspacePushEvent) => {
    // This test predates the queue, usage, and stale-base pipelines; ignore those events.
    if (
      evt.type === 'queue_changed' ||
      evt.type === 'usage_recorded' ||
      evt.type === 'base_advanced'
    )
      return
    const label = labels.get(evt.workspaceId) ?? evt.workspaceId.slice(0, 4)
    if (evt.type === 'agent_event') {
      const e = evt.event
      if (e.kind === 'session_started') {
        sessionByWs.set(evt.workspaceId, e.sessionId)
        console.log(`[${label}] session_started ${e.sessionId}`)
      } else if (e.kind === 'tool_use') {
        console.log(`[${label}] tool_use ${e.name}`)
      } else if (e.kind === 'tool_result') {
        console.log(`[${label}] tool_result ${e.name} ok=${e.ok}`)
      } else if (e.kind === 'assistant_text') {
        console.log(`[${label}] assistant ${e.text.replace(/\s+/g, ' ').slice(0, 80)}`)
      } else if (e.kind === 'turn_complete') {
        console.log(`[${label}] turn_complete session=${e.sessionId}`)
      } else if (e.kind === 'error') {
        console.log(`[${label}] error ${e.message}`)
      }
    } else {
      console.log(`[${label}] status -> ${evt.status}`)
      if (TERMINAL.has(evt.status)) {
        finished.set(evt.workspaceId, evt.status)
        if (finished.size === 2 && resolveAllDone) resolveAllDone()
      }
    }
  })

  try {
    await git(repoDir, ['init', '-b', 'main'])
    await git(repoDir, ['config', 'user.email', 'test@maestro.local'])
    await git(repoDir, ['config', 'user.name', 'Maestro Test'])
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# M3 App\n')
    await git(repoDir, ['add', '.'])
    await git(repoDir, ['commit', '-m', 'init'])

    await engine.worktrees.registerRepo(repoDir)
    repoName = path.basename(repoDir)

    const wsA = await engine.worktrees.createWorkspace({ repoPath: repoDir, name: 'task a' })
    const wsB = await engine.worktrees.createWorkspace({ repoPath: repoDir, name: 'task b' })
    labels.set(wsA.id, 'A')
    labels.set(wsB.id, 'B')
    console.log(`\nWorkspace A worktree: ${wsA.worktreePath}`)
    console.log(`Workspace B worktree: ${wsB.worktreePath}\n`)
    console.log('=== Starting two agents concurrently ===')

    // Kick off BOTH concurrently (startRun acks immediately).
    await Promise.all([
      supervisor.startRun(
        wsA.id,
        'Create a file named alpha.txt containing exactly the text AAA. Do not create any other files.'
      ),
      supervisor.startRun(
        wsB.id,
        'Create a file named bravo.txt containing exactly the text BBB. Do not create any other files.'
      )
    ])

    // Wait until both runs reach a terminal status (with a safety timeout).
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timed out waiting for both agents to finish')), 240_000)
    )
    await Promise.race([allDone, timeout])

    console.log('\n=== Verifying isolation ===')
    const aAlpha = fs.existsSync(path.join(wsA.worktreePath, 'alpha.txt'))
    const aBravo = fs.existsSync(path.join(wsA.worktreePath, 'bravo.txt'))
    const bBravo = fs.existsSync(path.join(wsB.worktreePath, 'bravo.txt'))
    const bAlpha = fs.existsSync(path.join(wsB.worktreePath, 'alpha.txt'))
    const aContent = aAlpha
      ? fs.readFileSync(path.join(wsA.worktreePath, 'alpha.txt'), 'utf8').trim()
      : '(missing)'
    const bContent = bBravo
      ? fs.readFileSync(path.join(wsB.worktreePath, 'bravo.txt'), 'utf8').trim()
      : '(missing)'

    const sessionA = sessionByWs.get(wsA.id)
    const sessionB = sessionByWs.get(wsB.id)

    console.log({
      A: { alphaPresent: aAlpha, alphaContent: aContent, bravoLeaked: aBravo, session: sessionA },
      B: { bravoPresent: bBravo, bravoContent: bContent, alphaLeaked: bAlpha, session: sessionB },
      statuses: Object.fromEntries(finished)
    })

    // Assertions.
    if (!aAlpha) throw new Error('A did not create alpha.txt')
    if (!bBravo) throw new Error('B did not create bravo.txt')
    if (aBravo) throw new Error('CROSS-CONTAMINATION: bravo.txt leaked into workspace A')
    if (bAlpha) throw new Error('CROSS-CONTAMINATION: alpha.txt leaked into workspace B')
    if (!sessionA || !sessionB) throw new Error('Missing a session id')
    if (sessionA === sessionB) throw new Error('Sessions cross-contaminated (same id)')

    console.log('\nMODULE 3 SMOKE TEST PASSED ✅')
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
  console.error('\nMODULE 3 SMOKE TEST FAILED ❌')
  console.error(err)
  process.exitCode = 1
})
