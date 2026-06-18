/**
 * Module 8 acceptance script — Codex harness.
 *
 * Two parts:
 *   A) Deterministic mapper test (always runs, no CLI needed): feed a recorded
 *      `codex exec --json` thread-event stream through CodexStreamMapper and
 *      assert it produces the expected normalized AgentEvent sequence — incl.
 *      session_started, tool_use/tool_result pairing for completed-only items,
 *      assistant_text, turn_complete with usage, and turn.failed -> error.
 *   B) Live turn (skipped if `codex` is not on PATH): drive a REAL Codex turn in
 *      an isolated worktree to create hello.txt, then a SECOND turn via
 *      `exec resume <sessionId>` to confirm session continuity.
 *
 * Uses the user's existing Codex login (no tokens). Run: `npm run smoke:m8`.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import execa from 'execa'
import { createEngine } from '../src/main/engine'
import { workspacesRoot } from '../src/main/engine/util/paths'
import { CodexHarness } from '../src/main/harness'
import { CodexStreamMapper } from '../src/main/harness/CodexStreamMapper'
import type { AgentEvent } from '@shared/types'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`)
}

/** Assert an event exists at `i` and has `kind`, returning it narrowed. */
function expect<K extends AgentEvent['kind']>(
  events: AgentEvent[],
  i: number,
  kind: K
): Extract<AgentEvent, { kind: K }> {
  const e = events[i]
  if (!e) throw new Error(`Assertion failed: no event at index ${i}`)
  if (e.kind !== kind) throw new Error(`Assertion failed: event ${i} is ${e.kind}, expected ${kind}`)
  return e as Extract<AgentEvent, { kind: K }>
}

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
      console.log(`${prefix} [turn_complete] session=${e.sessionId} out=${e.usage?.outputTokens ?? '?'}tok`)
      break
    case 'error':
      console.log(`${prefix} [error] ${e.message}`)
      break
  }
}

// --- Part A: deterministic mapper test against a recorded JSONL stream. ------

function mapperTest(): void {
  console.log('=== PART A: CodexStreamMapper (synthetic stream) ===')
  const mapper = new CodexStreamMapper()
  const lines = [
    '{"type":"thread.started","thread_id":"thr_abc123"}',
    '{"type":"turn.started"}',
    // command_execution as started + completed (paired tool_use/tool_result):
    '{"type":"item.started","item":{"id":"i1","type":"command_execution","command":"ls"}}',
    '{"type":"item.completed","item":{"id":"i1","type":"command_execution","command":"ls","exit_code":0,"aggregated_output":"hello.txt\\nREADME.md","status":"completed"}}',
    // file_change arrives ONLY as completed — mapper must synthesize the tool_use:
    '{"type":"item.completed","item":{"id":"i2","type":"file_change","status":"completed","changes":[{"kind":"add","path":"hello.txt"}]}}',
    // legacy field name `item_type` + `assistant_message` alias:
    '{"type":"item.completed","item":{"id":"i3","item_type":"assistant_message","text":"Created hello.txt with \\"hi\\"."}}',
    // streaming + reasoning noise that must be ignored:
    '{"type":"item.updated","item":{"id":"i3","type":"agent_message","text":"Crea"}}',
    '{"type":"item.completed","item":{"id":"i4","type":"reasoning","text":"thinking..."}}',
    // transient reconnect error — ignored, turn continues:
    '{"type":"error","message":"Reconnecting... 1/5"}',
    'not json — should be ignored',
    '{"type":"turn.completed","usage":{"input_tokens":8497,"cached_input_tokens":8448,"output_tokens":51}}'
  ]
  const events: AgentEvent[] = []
  for (const line of lines) events.push(...mapper.mapLine(line))

  for (const e of events) printEvent('  A', e)

  const kinds = events.map((e) => e.kind)
  assert(
    JSON.stringify(kinds) ===
      JSON.stringify([
        'session_started',
        'tool_use',
        'tool_result',
        'tool_use',
        'tool_result',
        'assistant_text',
        'turn_complete'
      ]),
    `unexpected event kinds: ${kinds.join(',')}`
  )

  const started = expect(events, 0, 'session_started')
  assert(started.sessionId === 'thr_abc123', 'thread id')

  // command_execution: started then completed, ok=true, output summarized.
  const cmdResult = expect(events, 2, 'tool_result')
  assert(cmdResult.name === 'command' && cmdResult.ok, 'command ok')

  // file_change: tool_use synthesized even though only item.completed was seen.
  const fcUse = expect(events, 3, 'tool_use')
  const fcResult = expect(events, 4, 'tool_result')
  assert(fcUse.name === 'file_change', 'file_change tool_use synthesized')
  assert(fcResult.ok && fcResult.summary === 'add hello.txt', 'file_change summary')

  const text = expect(events, 5, 'assistant_text')
  assert(text.text.includes('hello.txt'), 'assistant text')

  const done = expect(events, 6, 'turn_complete')
  assert(
    done.sessionId === 'thr_abc123' &&
      done.usage?.outputTokens === 51 &&
      done.usage?.cacheReadTokens === 8448,
    'turn_complete + usage (incl. thread id carried over)'
  )

  // turn.failed -> error (fresh mapper).
  const m2 = new CodexStreamMapper()
  const failEvents = [
    ...m2.mapLine('{"type":"thread.started","thread_id":"thr_x"}'),
    ...m2.mapLine('{"type":"turn.failed","error":{"message":"model response stream ended unexpectedly"}}')
  ]
  const failKinds = failEvents.map((e) => e.kind)
  assert(JSON.stringify(failKinds) === JSON.stringify(['session_started', 'error']), 'turn.failed kinds')
  const err = expect(failEvents, 1, 'error')
  assert(err.message.includes('stream ended'), 'failure message')

  console.log('Part A passed ✅\n')
}

// --- Part B: live Codex turn in an isolated worktree (skips if no CLI). ------

async function liveTest(): Promise<void> {
  console.log('=== PART B: live Codex turn ===')
  const harness = new CodexHarness() // defaults to workspace-write
  if (!(await harness.isAvailable())) {
    console.log('Codex CLI not found on PATH — skipping live Codex test.\n')
    return
  }

  const tempBase = path.join(os.tmpdir(), 'maestro test repos')
  fs.mkdirSync(tempBase, { recursive: true })
  const repoDir = path.join(tempBase, `m8 app ${Date.now()}`)
  fs.mkdirSync(repoDir, { recursive: true })
  const dbPath = path.join(tempBase, `m8-${Date.now()}.db`)
  const engine = createEngine(dbPath)
  let repoName = ''

  try {
    await git(repoDir, ['init', '-b', 'main'])
    await git(repoDir, ['config', 'user.email', 'test@maestro.local'])
    await git(repoDir, ['config', 'user.name', 'Maestro Test'])
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# M8 App\n')
    await git(repoDir, ['add', '.'])
    await git(repoDir, ['commit', '-m', 'init'])

    const repo = await engine.worktrees.registerRepo(repoDir)
    repoName = repo.name
    const ws = await engine.worktrees.createWorkspace({
      repoPath: repoDir,
      name: 'hello task',
      agentType: 'codex'
    })
    console.log(`\nWorktree: ${ws.worktreePath}\n`)

    console.log('--- TURN 1: create hello.txt ---')
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

    console.log('\n--- TURN 2: resume session ---')
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
      throw new Error(`Resume did not continue the same session (turn1=${r1.sessionId}, turn2=${r2.sessionId})`)
    }
    console.log('Part B passed ✅\n')
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

async function main(): Promise<void> {
  mapperTest()
  await liveTest()
  console.log('MODULE 8 SMOKE TEST PASSED ✅')
}

main().catch((err: unknown) => {
  console.error('\nMODULE 8 SMOKE TEST FAILED ❌')
  console.error(err)
  process.exitCode = 1
})
