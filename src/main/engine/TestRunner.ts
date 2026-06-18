import execa from 'execa'
import fs from 'fs'
import { MaestroError, TestCommandNotConfiguredError, WorkspaceNotFoundError } from './errors'
import { RepoStore } from './store/RepoStore'
import { WorkspaceStore } from './store/WorkspaceStore'
import { log } from '../log'
import { TestResultSchema, type TestResult } from '@shared/types'

/** Default wall-clock cap for a test run (overridable per call). */
const DEFAULT_TIMEOUT_MS = 10 * 60_000
/** Captured-output cap; we keep the tail (where failures print). */
const MAX_OUTPUT_BYTES = 64 * 1024

/**
 * Runs a repo's configured test/lint command inside a workspace's worktree and
 * returns a structured, captured TestResult (pass/fail + output + timing). A
 * focused execa wrapper — the test analog of GitService — kept separate from
 * WorktreeManager (git/worktree lifecycle) and from PtyManager (interactive
 * streaming shells); here we want a one-shot result, not a live terminal.
 *
 * SECURITY: this executes an UNTRUSTED, user-configured command string in a
 * shell (`shell: true`, so `&&`/pipes work). That is acceptable and equivalent
 * to the existing Terminal tab and the agent CLIs themselves — it runs on the
 * user's own machine, with their privileges, on a command they typed. We do not
 * attempt to sandbox it.
 */
export class TestRunner {
  private readonly workspaces: WorkspaceStore
  private readonly repos: RepoStore

  constructor(workspaces: WorkspaceStore, repos: RepoStore) {
    this.workspaces = workspaces
    this.repos = repos
  }

  async run(workspaceId: string, opts: { timeoutMs?: number } = {}): Promise<TestResult> {
    const ws = this.workspaces.getById(workspaceId)
    if (!ws) throw new WorkspaceNotFoundError(workspaceId)

    const command = this.repos.get(ws.repoPath)?.testCommand?.trim()
    if (!command) throw new TestCommandNotConfiguredError(ws.repoPath)

    if (!fs.existsSync(ws.worktreePath)) {
      throw new MaestroError(
        'WORKSPACE_NOT_FOUND',
        `Worktree no longer exists on disk: ${ws.worktreePath}`,
        { id: workspaceId, worktreePath: ws.worktreePath }
      )
    }

    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    log.info('tests.run', { workspaceId, timeout })

    const start = Date.now()
    let stdout = ''
    let exitCode = -1
    let timedOut = false
    try {
      const res = await execa(command, {
        cwd: ws.worktreePath,
        shell: true, // command string may contain &&, pipes, etc.
        all: true, // merge stdout+stderr into res.all
        reject: false, // inspect the result rather than throwing on non-zero
        timeout,
        killSignal: 'SIGKILL',
        windowsHide: true,
        encoding: 'utf8',
        // Nudge tools toward non-interactive, plain output; large buffer since we
        // clip to MAX_OUTPUT_BYTES ourselves below.
        env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
        maxBuffer: 16 * 1024 * 1024
      })
      stdout = String(res.all ?? `${res.stdout ?? ''}${res.stderr ?? ''}`)
      timedOut = res.timedOut === true
      exitCode = timedOut ? -1 : (res.exitCode ?? -1)
    } catch (err) {
      // Spawn-time failure (e.g. shell missing) — surface as a failed result.
      stdout = err instanceof Error ? err.message : String(err)
      exitCode = -1
      timedOut = false
    }

    const durationMs = Date.now() - start
    const truncated = Buffer.byteLength(stdout, 'utf8') > MAX_OUTPUT_BYTES
    const output = truncated ? clipTail(stdout, MAX_OUTPUT_BYTES) : stdout

    const result: TestResult = {
      ok: !timedOut && exitCode === 0,
      exitCode,
      output,
      truncated,
      timedOut,
      durationMs,
      command,
      ranAt: new Date().toISOString()
    }
    log.info('tests.done', { workspaceId, ok: result.ok, exitCode, durationMs, timedOut })
    // Validate the constructed object so any coding error surfaces immediately.
    return TestResultSchema.parse(result)
  }
}

/** Keep the last `maxBytes` of a string (UTF-8), where test failures print. */
function clipTail(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= maxBytes) return text
  // Slice on a byte boundary, then drop any partial leading char.
  return buf.subarray(buf.length - maxBytes).toString('utf8').replace(/^�/, '')
}
