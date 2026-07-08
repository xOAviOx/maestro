/**
 * Approval-gate acceptance script (interactive tool approval for the chat agent).
 *
 * Drives the REAL streaming ClaudeCodeHarness with a `requestPermission`
 * callback and proves the per-call gate end-to-end:
 *   1) APPROVE a Write → the file lands in the worktree.
 *   2) REJECT a Write → the file does NOT land (the deny blocked just that call).
 *
 * Reads (Glob/Read) never reach the callback — they auto-approve in the CLI.
 * Uses the user's existing Claude Code login (no tokens). Run: `npm run smoke:m15`.
 * If the CLI is unavailable, it reports that and exits 0 (skipped).
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import execa from 'execa'
import { ClaudeCodeHarness } from '../src/main/harness'
import type { PermissionDecision, PermissionRequest } from '../src/main/harness'
import type { AgentEvent } from '@shared/types'

async function makeWorktree(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-approval-'))
  await execa('git', ['init', '-q'], { cwd: dir })
  await execa('git', ['commit', '--allow-empty', '-qm', 'init'], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_NAME: 'm', GIT_AUTHOR_EMAIL: 'm@m', GIT_COMMITTER_NAME: 'm', GIT_COMMITTER_EMAIL: 'm@m' }
  })
  return dir
}

async function runTurn(
  worktreePath: string,
  prompt: string,
  answer: (req: PermissionRequest) => PermissionDecision
): Promise<void> {
  const harness = new ClaudeCodeHarness()
  const asked: string[] = []
  await harness.run(
    {
      worktreePath,
      prompt,
      resumeSessionId: null,
      requestPermission: async (req) => {
        asked.push(req.toolName)
        const decision = answer(req)
        console.log(`   ↳ permission: ${req.toolName} → ${decision.behavior}`)
        return decision
      }
    },
    (e: AgentEvent) => {
      if (e.kind === 'assistant_text') console.log(`   claude: ${e.text.slice(0, 80)}`)
      if (e.kind === 'tool_use') console.log(`   tool_use: ${e.name}`)
      if (e.kind === 'error') console.log(`   error: ${e.message}`)
    }
  )
  console.log(`   gated tools asked: [${asked.join(', ')}]`)
}

async function main(): Promise<void> {
  if (!(await new ClaudeCodeHarness().isAvailable())) {
    console.log('Claude Code CLI not found — skipping approval smoke.')
    return
  }

  // 1) APPROVE
  const wt1 = await makeWorktree()
  console.log('\n[1] APPROVE a write of approved.txt')
  await runTurn(wt1, 'Create a file named approved.txt containing OK. Then stop.', () => ({
    behavior: 'allow'
  }))
  const approvedExists = fs.existsSync(path.join(wt1, 'approved.txt'))
  console.log(`   approved.txt exists? ${approvedExists ? 'YES ✅' : 'NO ❌'}`)

  // 2) REJECT
  const wt2 = await makeWorktree()
  console.log('\n[2] REJECT a write of rejected.txt')
  await runTurn(wt2, 'Create a file named rejected.txt containing OK. Then stop.', () => ({
    behavior: 'deny',
    message: 'Rejected by smoke test.'
  }))
  const rejectedExists = fs.existsSync(path.join(wt2, 'rejected.txt'))
  console.log(`   rejected.txt exists? ${rejectedExists ? 'YES ❌ (should be blocked)' : 'NO ✅'}`)

  const ok = approvedExists && !rejectedExists
  console.log(`\n=== approval gate ${ok ? 'PASS ✅' : 'FAIL ❌'} ===`)
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
