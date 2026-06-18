import { randomUUID } from 'crypto'
import { createHarness, type ClaudeCodeHarnessOptions, type Harness } from '../harness'
import { credentialEnvVar } from '../harness'
import { log } from '../log'
import { MaestroError, toMaestroError } from './errors'
import type { Engine } from './index'
import type {
  AgentType,
  EnqueueJobInput,
  QueuedJob,
  WorkspacePushEvent,
  WorkspaceStatus
} from '@shared/types'

/** A push-event listener (the IPC layer subscribes one that broadcasts to windows). */
export type SupervisorListener = (evt: WorkspacePushEvent) => void

/** Builds a Harness for an agent type. Injectable so tests can swap in a fake
 * that completes instantly without a live CLI. Defaults to createHarness. */
export type HarnessFactory = (type: AgentType, opts?: ClaudeCodeHarnessOptions) => Harness

interface RunHandle {
  harness: Harness
  startedAt: string
}

/**
 * Owns the running-agent lifecycle on top of the engine.
 *
 * - Tracks active runs per workspace (a workspace runs at most one turn at a time).
 * - Drives the WorkspaceStatus state machine:
 *     idle --start--> running --complete--> awaiting_input
 * 
 *                            \--error-----> error
 *                            \--cancel----> idle
 * - Supports MULTIPLE concurrent runs across DIFFERENT workspaces: each run gets
 *   its own Harness instance and its own worktree, so child processes, sessions,
 *   and files never cross-contaminate.
 * - Forwards normalized agent events and status changes to subscribers, each
 *   tagged with the owning workspaceId.
 */
export class WorkspaceSupervisor {
  private readonly engine: Engine
  private readonly harnessOptions: ClaudeCodeHarnessOptions | undefined
  private readonly makeHarness: HarnessFactory
  private readonly active = new Map<string, RunHandle>()
  private readonly cancelRequested = new Set<string>()
  /** Workspaces whose startRun has been dispatched but not yet marked active
   * (it awaits getWorkspace first). Guards the pump against double-starting a
   * workspace's sequential jobs in the same synchronous scan. */
  private readonly starting = new Set<string>()
  private readonly listeners = new Set<SupervisorListener>()
  /** Pending jobs, FIFO. In-memory for the session (not yet persisted). */
  private queue: QueuedJob[] = []

  constructor(
    engine: Engine,
    harnessOptions?: ClaudeCodeHarnessOptions,
    harnessFactory: HarnessFactory = createHarness
  ) {
    this.engine = engine
    this.harnessOptions = harnessOptions
    this.makeHarness = harnessFactory
  }

  subscribe(listener: SupervisorListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  isRunning(workspaceId: string): boolean {
    return this.active.has(workspaceId)
  }

  /** True if the named agent CLI is available on this machine. */
  async isAgentAvailable(agentType: Harness['type']): Promise<boolean> {
    return this.makeHarness(agentType, this.harnessOptions).isAvailable()
  }

  /**
   * Start one agent turn for a workspace. Validates preconditions (workspace
   * exists, no run already active) and throws those back to the caller, then
   * launches the turn in the background and resolves immediately (an ack).
   * The turn's progress, completion, errors, and cancellation are surfaced via
   * push events + status changes — never thrown from the background loop.
   */
  async startRun(workspaceId: string, prompt: string, model?: string): Promise<void> {
    if (this.active.has(workspaceId) || this.starting.has(workspaceId)) {
      throw new MaestroError('INTERNAL', 'An agent is already running for this workspace.', {
        workspaceId
      })
    }
    // Reserve synchronously so a concurrent caller / pump scan can't race in
    // during the await below.
    this.starting.add(workspaceId)
    let ws
    try {
      ws = await this.engine.worktrees.getWorkspace(workspaceId)
    } catch (err) {
      this.starting.delete(workspaceId)
      throw err
    }

    const harness = this.makeHarness(ws.agentType, this.harnessOptions)
    this.active.set(workspaceId, { harness, startedAt: new Date().toISOString() })
    this.starting.delete(workspaceId)
    this.setStatus(workspaceId, 'running')

    const env = this.credentialEnv(ws.agentType)

    // Fire-and-forget: each concurrent run is fully independent.
    void this.runLoop(workspaceId, ws.worktreePath, ws.sessionId, harness, prompt, model, env)
  }

  /**
   * Build the optional credential env for an agent from the (opt-in) stored
   * headless credential. Returns undefined when nothing is configured, so the
   * common case relies purely on the CLI's own login. The secret is read only
   * here, at spawn time, and never logged.
   */
  private credentialEnv(agentType: AgentType): Record<string, string> | undefined {
    const cred = this.engine.credentials.reveal(agentType)
    if (!cred) return undefined
    const varName = credentialEnvVar(agentType, cred.kind)
    if (!varName) return undefined
    return { [varName]: cred.secret }
  }

  private async runLoop(
    workspaceId: string,
    worktreePath: string,
    resumeSessionId: string | null,
    harness: Harness,
    prompt: string,
    model?: string,
    env?: Record<string, string>
  ): Promise<void> {
    try {
      const { sessionId } = await harness.run(
        {
          worktreePath,
          prompt,
          ...(model ? { model } : {}),
          ...(env ? { env } : {}),
          resumeSessionId
        },
        (event) => this.emit({ type: 'agent_event', workspaceId, event })
      )
      if (sessionId) this.engine.workspaces.setSessionId(workspaceId, sessionId)
      this.setStatus(workspaceId, 'awaiting_input')
    } catch (err) {
      const wasCancelled = this.cancelRequested.has(workspaceId)
      const e = toMaestroError(err)
      log.warn('supervisor.run-ended', {
        workspaceId,
        cancelled: wasCancelled,
        code: e.code,
        message: e.message
      })
      this.setStatus(workspaceId, wasCancelled ? 'idle' : 'error')
    } finally {
      this.cancelRequested.delete(workspaceId)
      this.active.delete(workspaceId)
      // A run just ended: the next sequential job for this workspace, or any
      // dependent job now unblocked, may be runnable.
      this.pump()
    }
  }

  /** Cancel the in-flight run for a workspace, if any. */
  cancelRun(workspaceId: string): void {
    const handle = this.active.get(workspaceId)
    if (!handle) return
    this.cancelRequested.add(workspaceId)
    handle.harness.cancel()
    log.info('supervisor.cancel-requested', { workspaceId })
  }

  /** Cancel every active run (e.g. on app quit). */
  cancelAll(): void {
    for (const workspaceId of this.active.keys()) {
      this.cancelRun(workspaceId)
    }
  }

  // --- internals ---

  private setStatus(workspaceId: string, status: WorkspaceStatus): void {
    this.engine.workspaces.setStatus(workspaceId, status)
    this.emit({ type: 'status_changed', workspaceId, status })
  }

  private emit(evt: WorkspacePushEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(evt)
      } catch (err) {
        log.error('supervisor.listener-threw', { message: String(err) })
      }
    }
  }
}
