import execa from 'execa'
import readline from 'readline'
import { HarnessUnavailableError, MaestroError } from '../engine/errors'
import { log } from '../log'
import { AgentEventSchema, type AgentEvent } from '@shared/types'
import type { Harness, LaunchOptions } from './Harness'
import { ClaudeStreamMapper } from './ClaudeStreamMapper'
import { resolveClaudeBinary } from './resolveBinary'

/**
 * Claude Code permission posture. Default is `acceptEdits` — the least-dangerous
 * mode that still lets the agent edit files inside its isolated worktree without
 * a human approving every write. Exposed as a setting (constructor option) with
 * this safe default; `dangerously-skip-permissions`/`bypassPermissions` is NOT
 * the default (hard constraint). Verified against the live CLI
 * (`--permission-mode` choices: acceptEdits, auto, bypassPermissions, default,
 * dontAsk, plan).
 */
export type ClaudePermissionMode =
  | 'acceptEdits'
  | 'auto'
  | 'bypassPermissions'
  | 'default'
  | 'dontAsk'
  | 'plan'

export interface ClaudeCodeHarnessOptions {
  permissionMode?: ClaudePermissionMode
  /** Override binary path; otherwise resolved from PATH. */
  binaryPath?: string | null
}

// execa v5 ships its types via `export = execa`, so the child-process type is
// referenced through the namespace. `<string>` matches our encoding:'utf8' call.
type ChildProc = execa.ExecaChildProcess<string>

/**
 * Drives Claude Code in headless, structured-output mode (one-shot per turn;
 * multi-turn continuity via `--resume <sessionId>`).
 *
 * Confirmed flags (Claude Code v2.1.170):
 *   -p / --print                         headless, non-interactive
 *   --output-format stream-json          NDJSON event stream
 *   --verbose                            REQUIRED with stream-json under --print
 *   --permission-mode <mode>             see ClaudePermissionMode
 *   --model <model>                      optional model override
 *   -r / --resume <sessionId>            continue an existing session
 *
 * Alternative design: a long-lived process using `--input-format stream-json`
 * for true streaming multi-turn. We choose one-shot + `--resume` for the MVP:
 * it is simpler and more robust to supervise (each turn is a clean process).
 *
 * Auth: none is passed — Claude Code uses the user's existing login. Never
 * inject tokens.
 */
export class ClaudeCodeHarness implements Harness {
  readonly type = 'claude-code' as const

  private readonly permissionMode: ClaudePermissionMode
  private readonly binaryOverride: string | null
  private current: ChildProc | null = null
  private cancelled = false

  constructor(opts: ClaudeCodeHarnessOptions = {}) {
    this.permissionMode = opts.permissionMode ?? 'acceptEdits'
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
      const message =
        'Claude Code CLI not found. Install it and ensure `claude` is on your PATH.'
      onEvent({ kind: 'error', message })
      throw new HarnessUnavailableError(message, { type: this.type })
    }

    this.cancelled = false
    const mapper = new ClaudeStreamMapper()
    let sessionId: string | null = opts.resumeSessionId ?? null
    let sawTerminal = false

    const args = [
      '-p',
      opts.prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      this.permissionMode
    ]
    if (opts.model) args.push('--model', opts.model)
    if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId)

    log.info('harness.run', {
      type: this.type,
      worktreePath: opts.worktreePath,
      resume: Boolean(opts.resumeSessionId),
      permissionMode: this.permissionMode
    })

    const sub = execa(bin, args, {
      cwd: opts.worktreePath,
      // Ignore stdin so the CLI doesn't wait ~3s for piped input in one-shot mode.
      stdin: 'ignore',
      env: { ...process.env },
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
      const message = `Claude Code exited with code ${result.exitCode}. ${stderrText.trim().slice(0, 500)}`.trim()
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
      // Kill the whole process tree (a .cmd shim spawns a child node process).
      void execa('taskkill', ['/pid', String(pid), '/T', '/F'], { reject: false })
    } else {
      sub.kill('SIGTERM')
    }
  }

  private resolveBinary(): Promise<string | null> {
    if (this.binaryOverride) return Promise.resolve(this.binaryOverride)
    return resolveClaudeBinary()
  }
}
