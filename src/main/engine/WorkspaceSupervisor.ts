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
  TokenUsage,
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
        (event) => {
          this.emit({ type: 'agent_event', workspaceId, event })
          // Module 13 — usage & cost: persist each turn's token/cost sample.
          if (event.kind === 'turn_complete' && event.usage) {
            this.recordUsage(workspaceId, event.usage)
          }
        }
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

  // --- queue ----------------------------------------------------------------

  /** The current pending-job queue (a copy). */
  listQueue(): QueuedJob[] {
    return [...this.queue]
  }

  /**
   * Enqueue an agent turn. Validates the workspace exists, appends the job, and
   * immediately tries to run it (pump). Returns the created job. The job runs
   * FIFO once its workspace is free and its dependency (if any) has finished.
   */
  async enqueue(input: EnqueueJobInput): Promise<QueuedJob> {
    await this.engine.worktrees.getWorkspace(input.workspaceId) // throws if missing
    const job: QueuedJob = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      prompt: input.prompt,
      ...(input.model ? { model: input.model } : {}),
      dependsOnWorkspaceId: input.dependsOnWorkspaceId ?? null,
      createdAt: new Date().toISOString()
    }
    this.queue.push(job)
    log.info('supervisor.enqueued', {
      jobId: job.id,
      workspaceId: job.workspaceId,
      dependsOn: job.dependsOnWorkspaceId
    })
    this.emitQueue()
    this.pump()
    return job
  }

  /** Remove a pending job. No effect once it has started (it's already off the queue). */
  cancelJob(jobId: string): void {
    const before = this.queue.length
    this.queue = this.queue.filter((j) => j.id !== jobId)
    if (this.queue.length !== before) {
      log.info('supervisor.job-cancelled', { jobId })
      this.emitQueue()
    }
  }

  /**
   * Start every job that is currently runnable. A job is runnable when:
   *   - its workspace has no active run, AND
   *   - its dependency is satisfied: no dependsOnWorkspaceId, OR that workspace
   *     is not active, has no pending job ahead of it, and finished in a
   *     non-error terminal state (awaiting_input | done).
   * If a dependency ended in `error`, the dependent job is dropped (its
   * pipeline can't proceed) rather than waiting forever.
   *
   * Scans FIFO and may start several independent jobs in one pass. Safe to call
   * often (enqueue, run completion); it only ever starts runnable jobs.
   */
  private pump(): void {
    let madeProgress = true
    while (madeProgress) {
      madeProgress = false
      for (const job of this.queue) {
        if (this.active.has(job.workspaceId) || this.starting.has(job.workspaceId)) continue

        if (job.dependsOnWorkspaceId) {
          const dep = job.dependsOnWorkspaceId
          if (this.active.has(dep) || this.starting.has(dep)) continue // dep still busy — wait
          if (this.queue.some((j) => j.workspaceId === dep)) continue // dep has queued work
          const depWs = this.engine.workspaces.getById(dep)
          const depStatus = depWs?.status
          if (depStatus === 'error') {
            // Dependency failed: drop the dependent job so it doesn't hang.
            log.warn('supervisor.job-dropped-dep-error', { jobId: job.id, dep })
            this.queue = this.queue.filter((j) => j.id !== job.id)
            this.emitQueue()
            madeProgress = true
            break
          }
          if (depStatus !== 'awaiting_input' && depStatus !== 'done') continue
        }

        // Runnable: remove from queue and start. startRun reserves the workspace
        // synchronously (this.starting) so the re-scan won't double-start it.
        this.queue = this.queue.filter((j) => j.id !== job.id)
        this.emitQueue()
        void this.startRun(job.workspaceId, job.prompt, job.model).catch((err) => {
          log.warn('supervisor.queued-start-failed', {
            jobId: job.id,
            message: toMaestroError(err).message
          })
        })
        madeProgress = true
        break // queue mutated; re-scan from the top
      }
    }
  }

  // --- internals ---

  /**
   * Persist one turn's token/cost usage sample and broadcast it. Best-effort:
   * a persistence failure is logged and swallowed so it can never break the
   * run loop (the turn itself succeeded). Missing token counts store as 0; a
   * missing model / CLI-reported cost stores as null (cost is then derived from
   * the pricing table at read time — never guessed here).
   */
  private recordUsage(workspaceId: string, usage: TokenUsage): void {
    try {
      const stored = this.engine.usageEvents.record({
        workspaceId,
        model: usage.model ?? null,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheCreationTokens: usage.cacheCreationTokens ?? 0,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        cliCostUsd: usage.totalCostUsd ?? null
      })
      this.emit({ type: 'usage_recorded', workspaceId, usage: stored })
    } catch (err) {
      log.warn('supervisor.usage-record-failed', { workspaceId, message: String(err) })
    }
  }

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

  /** Broadcast the current pending queue to subscribers. */
  private emitQueue(): void {
    this.emit({ type: 'queue_changed', jobs: this.listQueue() })
  }
}
