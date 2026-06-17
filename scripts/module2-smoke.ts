/**
 * Module 2 acceptance script.
 *
 * Drives a REAL Claude Code turn in an isolated worktree:
 *   1) Ask it to create hello.txt containing "hi", print the normalized
 *      AgentEvent stream, and confirm the file exists in the worktree.
 *   2) Run a SECOND turn with --resume <sessionId> and confirm the same
 *      session continues (it should "remember" the file it just created).
 *
 * Uses the user's existing Claude Code login (no tokens). Run: `npm run smoke:m2`.
 * If the CLI is unavailable, the script reports that and exits 0 (skipped).
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import execa from 'execa'
import { createEngine } from '../src/main/engine'
import { workspacesRoot } from '../src/main/engine/util/paths'
import { ClaudeCodeHarness } from '../src/main/harness'
import type { AgentEvent } from '@shared/types'

async function git(cwd: string, args: string[]): Promise<void> {
  await execa('git', args, { cwd, env: { ...process.env, GIT_PAGER: 'cat' } })
}

function printEvent(prefix: string, e: AgentEvent): void {
  switch (e.kind) {
    case 'session_started':
      console.log(`${prefix} [session_started] ${e.sessionId}`)
      break
    case 'assistant_text':
      console.log(`${prefix} [assistant] ${e.text.replace(/\s+/g, ' ').slice(0, 160)}`)
      break
    case 'tool_use':
      console.log(`${prefix} [tool_use] ${e.name} ${JSON.stringify(e.input).slice(0, 120)}`)
      break
    case 'tool_result':
      console.log(`${prefix} [tool_result] ${e.name} ok=${e.ok}${e.summary ? ' :: ' + e.summary : ''}`)
      break
    case 'turn_complete':
      console.log(
        `${prefix} [turn_complete] session=${e.sessionId} cost=$${e.usage?.totalCostUsd ?? '?'} out=${e.usage?.outputTokens ?? '?'}tok`
      )
      break
    case 'error':
      console.log(`${prefix} [error] ${e.message}`)
      break
  }
}

async function main(): Promise<void> {
  const harness = new ClaudeCodeHarness() // defaults to acceptEdits
  if (!(await harness.isAvailable())) {
    console.log('Claude Code CLI not found on PATH — skipping Module 2 live test.')
    return
  }

  const tempBase = path.join(os.tmpdir(), 'maestro test repos')
  fs.mkdirSync(tempBase, { recursive: true })
  const repoDir = path.join(tempBase, `m2 app ${Date.now()}`)
  fs.mkdirSync(repoDir, { recursive: true })
  const dbPath = path.join(tempBase, `m2-${Date.now()}.db`)
  const engine = createEngine(dbPath)
  let repoName = ''

  try {
    await git(repoDir, ['init', '-b', 'main'])
    await git(repoDir, ['config', 'user.email', 'test@maestro.local'])
    await git(repoDir, ['config', 'user.name', 'Maestro Test'])
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# M2 App\n')
    await git(repoDir, ['add', '.'])
    await git(repoDir, ['commit', '-m', 'init'])

    const repo = await engine.worktrees.registerRepo(repoDir)
    repoName = repo.name
    const ws = await engine.worktrees.createWorkspace({
      repoPath: repoDir,
      name: 'hello task',
      agentType: 'claude-code'
    })
    console.log(`\nWorktree: ${ws.worktreePath}\n`)

    // --- Turn 1: create the file. ---
    console.log('=== TURN 1: create hello.txt ===')
    const r1 = await harness.run(
      {
        worktreePath: ws.worktreePath,
        prompt:
          'Create a file named hello.txt in the current directory containing exactly the text: hi (lowercase, no quotes). Do not create any other files.'
      },
      (e) => printEvent('  T1', e)
    )
    console.log(`Turn 1 sessionId: ${r1.sessionId}`)

    const helloPath = path.join(ws.worktreePath, 'hello.txt')
    const helloExists = fs.existsSync(helloPath)
    const helloContent = helloExists ? fs.readFileSync(helloPath, 'utf8').trim() : '(missing)'
    console.log(`\nhello.txt exists? ${helloExists} | content: "${helloContent}"`)
    if (!helloExists) throw new Error('Turn 1 did not create hello.txt')
    if (!r1.sessionId) throw new Error('Turn 1 did not return a sessionId')

    // --- Turn 2: resume the same session. ---
    console.log('\n=== TURN 2: resume session and ask what it created ===')
    let turn2Session = ''
    const r2 = await harness.run(
      {
        worktreePath: ws.worktreePath,
        prompt: 'In one short sentence, what file did you just create and what does it contain?',
        resumeSessionId: r1.sessionId
      },
      (e) => {
        if (e.kind === 'turn_complete') turn2Session = e.sessionId
        printEvent('  T2', e)
      }
    )
    console.log(`Turn 2 sessionId: ${r2.sessionId}`)

    const resumedSameSession = r2.sessionId === r1.sessionId || turn2Session === r1.sessionId
    console.log(`\nResumed same session? ${resumedSameSession}`)
    if (!resumedSameSession) {
      throw new Error(
        `Resume did not continue the same session (turn1=${r1.sessionId}, turn2=${r2.sessionId})`
      )
    }

    console.log('\nMODULE 2 SMOKE TEST PASSED ✅')
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
  console.error('\nMODULE 2 SMOKE TEST FAILED ❌')
  console.error(err)
  process.exitCode = 1
})
