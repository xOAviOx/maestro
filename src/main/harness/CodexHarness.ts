import execa from 'execa'
import readline from 'readline'
import { HarnessUnavailableError, MaestroError } from '../engine/errors'
import { log } from '../log'
import { AgentEventSchema, type AgentEvent } from '@shared/types'
import type { Harness, LaunchOptions } from './Harness'
import { CodexStreamMapper } from './CodexStreamMapper'
import { resolveCodexBinary } from './resolveBinary'

/**
 * Codex sandbox posture. Default is `workspace-write` — the analog of Claude's
 * `acceptEdits`: the agent may edit files inside its isolated worktree (and run
 * commands) without a human approving every action, but it gets no network and
 * no access outside the workspace. `danger-full-access` is the analog of
 * `bypassPermissions` and is NOT the default (hard constraint). Exposed as a
 * constructor option with this safe default.
 * (Codex `exec --sandbox` choices: read-only, workspace-write, danger-full-access.)
 */
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

export interface CodexHarnessOptions {
  sandbox?: CodexSandboxMode
  /** Override binary path; otherwise resolved from PATH. */
  binaryPath?: string | null
}

// execa v5 ships its types via `export = execa`, so the child-process type is
// referenced through the namespace. `<string>` matches our encoding:'utf8' call.
type ChildProc = execa.ExecaChildProcess<string>

/**
 * Drives the Codex CLI in headless, structured-output mode (one-shot per turn;
 * multi-turn continuity via `codex exec resume <sessionId>`).
 *
 * Mirrors ClaudeCodeHarness: spawn the CLI, read NDJSON from stdout, map each
 * line to a normalized AgentEvent via CodexStreamMapper, and resolve with the
 * session id (Codex's thread_id) for resume.
 *
 * Confirmed flags (Codex CLI `exec`):
 *   exec [PROMPT|-]                      headless, non-interactive (`-` = stdin)
 *   --json                               NDJSON thread-event stream on stdout
 *   -s / --sandbox <mode>                see CodexSandboxMode
 *   --skip-git-repo-check                tolerate non-repo cwd (harmless in a worktree)
 *   -m / --model <model>                 optional model override
 *   exec resume <SESSION_ID> [PROMPT|-]  continue an existing session
 *
 * The prompt is piped via stdin (positional `-`) so a prompt beginning with `-`
 * is never mis-parsed as a flag. execa runs the binary without a shell, so args
 * are not shell-interpreted either way.
 *
 * Auth: by default none is passed — Codex uses the user's existing login. The
 * supervisor may optionally pass `opts.env` carrying a user-configured headless
 * credential (OPENAI_API_KEY); it is merged on top of the inherited env and
 * never logged. We never synthesize or guess tokens.
 */
export class CodexHarness implements Harness {
  readonly type = 'codex' as const

  private readonly sandbox: CodexSandboxMode
  private readonly binaryOverride: string | null
  private current: ChildProc | null = null
  private cancelled = false

  constructor(opts: CodexHarnessOptions = {}) {
    this.sandbox = opts.sandbox ?? 'workspace-write'
    this.binaryOverride = opts.binaryPath ?? null
  }

  async isAvailable(): Promise<boolean> {
    return (await this.resolveBinary()) !== null
  }

  async run(
    opts: LaunchOptions,
    onEvent: (e: AgentEvent) => void
  ): Promise<{ sessionId: string }> {
    const bin = await this.resolveBinary()
    if (!bin) {
      const message = 'Codex CLI not found. Install it and ensure `codex` is on your PATH.'
      onEvent({ kind: 'error', message })
      throw new HarnessUnavailableError(message, { type: this.type })
    }

    this.cancelled = false
    const mapper = new CodexStreamMapper()
    let sessionId: string | null = opts.resumeSessionId ?? null
    let sawTerminal = false

    // Common exec flags. The prompt is read from stdin (positional `-`).
    const flags = [
      '--json',
      '--sandbox',
      this.sandbox,
      '--skip-git-repo-check'
    ]
    if (opts.model) flags.push('--model', opts.model)

    const args = opts.resumeSessionId
      ? ['exec', 'resume', opts.resumeSessionId, ...flags, '-']
      : ['exec', ...flags, '-']

    log.info('harness.run', {
      type: this.type,
      worktreePath: opts.worktreePath,
      resume: Boolean(opts.resumeSessionId),
      sandbox: this.sandbox
    })

    const sub = execa(bin, args, {
      cwd: opts.worktreePath,
      // Pipe the prompt in and close stdin so the CLI doesn't block.
      input: opts.prompt,
      // Inherit the user's env (so the CLI's own login works), then layer any
      // explicitly-provided credential env on top.
      env: { ...process.env, ...(opts.env ?? {}) },
      windowsHide: true,
      encoding: 'utf8',
      buffer: false, // we stream stdout ourselves
      reject: false // handle non-zero exit explicitly below
    })
    this.current = sub

    const emit = (evt: AgentEvent): void => {
      // Belt-and-suspenders: validate every event before it leaves the harness.
      const parsed = AgentEventSchema.safeParse(evt)
      if (parsed.success) onEvent(parsed.data)
      else log.warn('harness.invalid-event', { issues: parsed.error.issues.length })
    }

    const stdout = sub.stdout
    if (stdout) {
      stdout.setEncoding('utf8')
      const rl = readline.createInterface({ input: stdout, crlfDelay: Infinity })
      rl.on('line', (line: string) => {
        for (const evt of mapper.mapLine(line)) {
          if (evt.kind === 'session_started') sessionId = evt.sessionId
          if (evt.kind === 'turn_complete') {
            sessionId = evt.sessionId || sessionId
            sawTerminal = true
          }
          if (evt.kind === 'error') sawTerminal = true
          emit(evt)
        }
      })
    }

    let stderrText = ''
    const stderr = sub.stderr
    if (stderr) {
      stderr.setEncoding('utf8')
      stderr.on('data', (chunk: string) => {
        stderrText += chunk
      })
    }

    const result = await sub
    this.current = null

    if (this.cancelled) {
      const message = 'Run cancelled.'
      emit({ kind: 'error', message })
      throw new MaestroError('INTERNAL', message)
    }

    if (result.exitCode !== 0 && !sawTerminal) {
      const message = `Codex exited with code ${result.exitCode}. ${stderrText.trim().slice(0, 500)}`.trim()
      emit({ kind: 'error', message })
      throw new HarnessUnavailableError(message, { exitCode: result.exitCode })
    }

    return { sessionId: sessionId ?? '' }
  }

  cancel(): void {
    this.cancelled = true
    const sub = this.current
    if (!sub) return
    const pid = sub.pid
    if (process.platform === 'win32' && pid !== undefined) {
      // Kill the whole process tree (a .cmd shim spawns a child process).
      void execa('taskkill', ['/pid', String(pid), '/T', '/F'], { reject: false })
    } else {
      sub.kill('SIGTERM')
    }
  }

  private resolveBinary(): Promise<string | null> {
    if (this.binaryOverride) return Promise.resolve(this.binaryOverride)
    return resolveCodexBinary()
  }
}
