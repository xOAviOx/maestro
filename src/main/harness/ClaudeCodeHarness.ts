import execa from 'execa'
import readline from 'readline'
import { HarnessUnavailableError, MaestroError } from '../engine/errors'
import { log } from '../log'
import { AgentEventSchema, type AgentEvent } from '@shared/types'
import type { Harness, LaunchOptions, PermissionDecision } from './Harness'
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
 * Drives Claude Code in headless, structured-output mode. Two internal paths,
 * chosen per turn by whether the caller supplied `requestPermission`:
 *
 *  - AUTONOMOUS (no approval callback): one-shot `-p <prompt>` with the
 *    configured `--permission-mode`. Unchanged from the original design; used by
 *    workflows and fan-out where no human is watching.
 *
 *  - INTERACTIVE (approval callback present): a streaming `--input-format
 *    stream-json` session with `--permission-mode default --permission-prompt-tool
 *    stdio`. Claude then emits a `can_use_tool` control request before each gated
 *    tool call (writes / shell); the harness forwards it to `requestPermission`
 *    and replies allow/deny over the control channel. Reads auto-approve inside
 *    the CLI and never surface. This is the per-call Approve/Reject gate. We
 *    still run one process per turn (multi-turn continuity via `--resume`), so
 *    the supervisor's "run() resolves when the turn completes" contract holds.
 *
 * Confirmed flags (Claude Code v2.1.196):
 *   -p / --print                         headless, non-interactive (one-shot)
 *   --input-format stream-json           NDJSON turn input (streaming path)
 *   --output-format stream-json          NDJSON event stream
 *   --verbose                            REQUIRED with stream-json
 *   --permission-mode <mode>             see ClaudePermissionMode
 *   --permission-prompt-tool stdio       route tool permission to the control channel
 *   --model <model>                      optional model override
 *   -r / --resume <sessionId>            continue an existing session
 *
 * Auth: by default none is passed — Claude Code uses the user's existing login.
 * The supervisor may optionally pass `opts.env` carrying a user-configured
 * headless credential; it is merged on top of the inherited env and never logged.
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
    return opts.requestPermission
      ? this.runStreaming(bin, opts, onEvent)
      : this.runOneShot(bin, opts, onEvent)
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

  // --- autonomous one-shot (unchanged behavior) ------------------------------

  private async runOneShot(
    bin: string,
    opts: LaunchOptions,
    onEvent: (e: AgentEvent) => void
  ): Promise<{ sessionId: string }> {
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
      permissionMode: this.permissionMode,
      gated: false
    })

    const sub = execa(bin, args, {
      cwd: opts.worktreePath,
      // Ignore stdin so the CLI doesn't wait ~3s for piped input in one-shot mode.
      stdin: 'ignore',
      env: { ...process.env, ...(opts.env ?? {}) },
      windowsHide: true,
      encoding: 'utf8',
      buffer: false, // we stream stdout ourselves
      reject: false // handle non-zero exit explicitly below
    })
    this.current = sub

    const emit = makeEmitter(onEvent)

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

    const stderrText = captureStderr(sub)

    const result = await sub
    this.current = null

    if (this.cancelled) {
      const message = 'Run cancelled.'
      emit({ kind: 'error', message })
      throw new MaestroError('INTERNAL', message)
    }

    if (result.exitCode !== 0 && !sawTerminal) {
      const message =
        `Claude Code exited with code ${result.exitCode}. ${stderrText().trim().slice(0, 500)}`.trim()
      emit({ kind: 'error', message })
      throw new HarnessUnavailableError(message, { exitCode: result.exitCode })
    }

    return { sessionId: sessionId ?? '' }
  }

  // --- interactive streaming with per-tool approval --------------------------

  private async runStreaming(
    bin: string,
    opts: LaunchOptions,
    onEvent: (e: AgentEvent) => void
  ): Promise<{ sessionId: string }> {
    this.cancelled = false
    const requestPermission = opts.requestPermission!
    const mapper = new ClaudeStreamMapper()
    let sessionId: string | null = opts.resumeSessionId ?? null
    let sawTerminal = false
    let userMessageSent = false
    let finished = false

    const args = [
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      // `default` is what makes gated tools ask; `--permission-prompt-tool stdio`
      // routes that ask onto this process's control channel instead of a TTY.
      '--permission-mode',
      'default',
      '--permission-prompt-tool',
      'stdio'
    ]
    if (opts.model) args.push('--model', opts.model)
    if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId)

    log.info('harness.run', {
      type: this.type,
      worktreePath: opts.worktreePath,
      resume: Boolean(opts.resumeSessionId),
      permissionMode: 'default',
      gated: true
    })

    const sub = execa(bin, args, {
      cwd: opts.worktreePath,
      stdin: 'pipe', // we drive the turn over stdin (init + user message + control responses)
      env: { ...process.env, ...(opts.env ?? {}) },
      windowsHide: true,
      encoding: 'utf8',
      buffer: false,
      reject: false
    })
    this.current = sub

    const emit = makeEmitter(onEvent)

    const writeLine = (obj: unknown): void => {
      const stdin = sub.stdin
      if (!stdin || stdin.destroyed || this.cancelled) return
      try {
        stdin.write(JSON.stringify(obj) + '\n')
      } catch (err) {
        log.warn('harness.stdin-write-failed', { message: String(err) })
      }
    }

    const sendUserMessage = (): void => {
      if (userMessageSent) return
      userMessageSent = true
      writeLine({ type: 'user', message: { role: 'user', content: opts.prompt } })
    }

    // End the turn: the `result` line means every tool effect has already
    // landed, so tearing the process down here is safe and deterministic.
    const finish = (): void => {
      if (finished) return
      finished = true
      const stdin = sub.stdin
      try {
        stdin?.end()
      } catch {
        /* already closed */
      }
      // Give the CLI a beat to exit on its own after stdin closes; force-kill if
      // it lingers so `await sub` can resolve.
      setTimeout(() => {
        if (this.current === sub) this.cancel()
      }, 400)
    }

    const handleControlRequest = (msg: ControlRequest): void => {
      const req = msg.request
      if (req?.subtype === 'can_use_tool') {
        const toolName = typeof req.tool_name === 'string' ? req.tool_name : 'tool'
        const input = req.input ?? req.tool_input ?? {}
        void requestPermission({ toolName, input })
          .then((decision) => respondPermission(msg.request_id, decision, input))
          .catch((err) => {
            // A failure to obtain a decision must not hang the agent: deny safely.
            log.warn('harness.permission-callback-failed', { message: String(err) })
            respondPermission(msg.request_id, { behavior: 'deny', message: 'Approval unavailable.' }, input)
          })
        return
      }
      // Any other control request (init echoes, etc.) just needs an ack.
      writeLine({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id } })
    }

    // The control protocol requires `updatedInput` on an allow (echo the
    // original input when the host didn't revise it); a bare `{behavior:'allow'}`
    // is treated as a harness error and the tool silently fails.
    const respondPermission = (
      requestId: string,
      decision: PermissionDecision,
      originalInput: unknown
    ): void => {
      const response =
        decision.behavior === 'allow'
          ? { behavior: 'allow', updatedInput: decision.updatedInput ?? originalInput ?? {} }
          : { behavior: 'deny', message: decision.message ?? 'Denied.' }
      writeLine({
        type: 'control_response',
        response: { subtype: 'success', request_id: requestId, response }
      })
    }

    const stdout = sub.stdout
    if (stdout) {
      stdout.setEncoding('utf8')
      const rl = readline.createInterface({ input: stdout, crlfDelay: Infinity })
      rl.on('line', (line: string) => {
        const trimmed = line.trim()
        if (trimmed.length === 0) return
        let parsed: unknown
        try {
          parsed = JSON.parse(trimmed)
        } catch {
          return // not JSON — ignore
        }
        const type = isRecord(parsed) ? parsed['type'] : undefined
        if (type === 'control_request') {
          handleControlRequest(parsed as ControlRequest)
          return
        }
        if (type === 'control_response') {
          // The reply to our `initialize` handshake — safe to start the turn now.
          if (getResponseRequestId(parsed) === INIT_REQUEST_ID) sendUserMessage()
          return
        }
        // Ordinary agent output → normalized events.
        for (const evt of mapper.mapParsed(parsed)) {
          if (evt.kind === 'session_started') sessionId = evt.sessionId
          if (evt.kind === 'turn_complete') {
            sessionId = evt.sessionId || sessionId
            sawTerminal = true
          }
          if (evt.kind === 'error') sawTerminal = true
          emit(evt)
          if (evt.kind === 'turn_complete' || evt.kind === 'error') finish()
        }
      })
    }

    const stderrText = captureStderr(sub)

    // Kick off the handshake; the user message follows once it's acknowledged.
    // Fallback: if no control_response arrives promptly, send it anyway so the
    // turn can't stall on a protocol we mis-guessed.
    writeLine({ type: 'control_request', request_id: INIT_REQUEST_ID, request: { subtype: 'initialize' } })
    const kickoff = setTimeout(sendUserMessage, 1500)

    const result = await sub
    clearTimeout(kickoff)
    this.current = null

    if (this.cancelled && !sawTerminal) {
      const message = 'Run cancelled.'
      emit({ kind: 'error', message })
      throw new MaestroError('INTERNAL', message)
    }

    if (result.exitCode !== 0 && !sawTerminal && !finished) {
      const message =
        `Claude Code exited with code ${result.exitCode}. ${stderrText().trim().slice(0, 500)}`.trim()
      emit({ kind: 'error', message })
      throw new HarnessUnavailableError(message, { exitCode: result.exitCode })
    }

    return { sessionId: sessionId ?? '' }
  }

  private resolveBinary(): Promise<string | null> {
    if (this.binaryOverride) return Promise.resolve(this.binaryOverride)
    return resolveClaudeBinary()
  }
}

const INIT_REQUEST_ID = 'maestro-init'

interface ControlRequest {
  request_id: string
  request?: {
    subtype?: string
    tool_name?: unknown
    input?: unknown
    tool_input?: unknown
  }
}

/** Validate-and-forward wrapper shared by both run paths. */
function makeEmitter(onEvent: (e: AgentEvent) => void): (evt: AgentEvent) => void {
  return (evt: AgentEvent): void => {
    const parsed = AgentEventSchema.safeParse(evt)
    if (parsed.success) onEvent(parsed.data)
    else log.warn('harness.invalid-event', { issues: parsed.error.issues.length })
  }
}

/** Accumulate stderr; returns a getter for the collected text. */
function captureStderr(sub: ChildProc): () => string {
  let text = ''
  const stderr = sub.stderr
  if (stderr) {
    stderr.setEncoding('utf8')
    stderr.on('data', (chunk: string) => {
      text += chunk
    })
  }
  return () => text
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** control_response nests the correlating id at response.request_id. */
function getResponseRequestId(msg: unknown): string | undefined {
  if (!isRecord(msg)) return undefined
  const response = msg['response']
  if (!isRecord(response)) return undefined
  const id = response['request_id']
  return typeof id === 'string' ? id : undefined
}
