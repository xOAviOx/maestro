import { randomUUID } from 'crypto'
import { log } from '../../log'
import {
  InvalidTaskStateError,
  TaskNotFoundError,
  WorkflowCycleError,
  WorkflowNotFoundError
} from '../errors'
import { computeReady, descendants, detectCycle, fifoReadyOrder, findMissingDependencies } from './dag'
import type { TaskRunner } from './TaskRunner'
import {
  CreateWorkflowInputSchema,
  TERMINAL_TASK_STATUSES,
  type CreateWorkflowInput,
  type Task,
  type Workflow,
  type WorkflowStatus
} from '@shared/types'

/**
 * The persistence surface the scheduler needs. Implemented by the SQLite
 * `WorkflowStore` in production and by a trivial in-memory fake in unit tests —
 * so the scheduler's DAG logic is tested without the native `better-sqlite3`
 * module (keeping Vitest ABI-independent).
 */
export interface WorkflowRepository {
  create(workflow: Workflow): void
  get(id: string): Workflow | undefined
  list(): Workflow[]
  setWorkflowStatus(id: string, status: WorkflowStatus): void
  saveTask(workflowId: string, task: Task): void
}

export interface WorkflowSchedulerOptions {
  store: WorkflowRepository
  runner: TaskRunner
  /** Called with a fresh snapshot after any workflow/task change (drives IPC push). */
  emit?: (workflow: Workflow) => void
  /** Resolve a repo's default base branch when `baseBranch` is omitted on create. */
  resolveBaseBranch?: (repoPath: string) => Promise<string>
  /** Injectable clock for deterministic tests. */
  now?: () => number
}

/**
 * Owns the Task-DAG lifecycle in the main process. The renderer only reflects
 * state via push snapshots — every transition (blocked→ready→running→completed→
 * merged, plus reject/cancel/fail/retry) happens here.
 *
 * Invariants:
 *  - A task is `ready` only when ALL its dependencies are `merged`.
 *  - At most `maxConcurrency` tasks are `running` per workflow.
 *  - Merges are serialized per repo (never two concurrent merges into base).
 *  - The store is the source of truth, so an app restart can recover the graph.
 */
export class WorkflowScheduler {
  private readonly store: WorkflowRepository
  private readonly runner: TaskRunner
  private readonly emitFn: ((workflow: Workflow) => void) | undefined
  private readonly resolveBaseBranch: ((repoPath: string) => Promise<string>) | undefined
  private readonly now: () => number
  /**
   * The serial merge queue: one promise chain per repo so merges into a base
   * branch never overlap. Instance-local on purpose — NOT the shared engine
   * `withLock`, whose key the underlying `mergeWorkspace` also takes; reusing it
   * here would be a non-reentrant self-deadlock. Single-flight here means the
   * engine's own repo lock is always uncontended when a merge reaches it.
   */
  private readonly mergeChains = new Map<string, Promise<unknown>>()

  constructor(options: WorkflowSchedulerOptions) {
    this.store = options.store
    this.runner = options.runner
    this.emitFn = options.emit
    this.resolveBaseBranch = options.resolveBaseBranch
    this.now = options.now ?? (() => Date.now())
  }

  // --- reads ---------------------------------------------------------------

  listWorkflows(): Workflow[] {
    return this.store.list()
  }

  getWorkflow(id: string): Workflow {
    return this.requireWorkflow(id)
  }

  /** Ids that a `cascade` rejection of this task would cancel (its descendants). */
  previewCascade(workflowId: string, taskId: string): string[] {
    const wf = this.requireWorkflow(workflowId)
    if (!wf.tasks.some((t) => t.id === taskId)) throw new TaskNotFoundError(workflowId, taskId)
    return descendants(wf.tasks, taskId)
  }

  // --- authoring -----------------------------------------------------------

  /**
   * Validate (unique ids, no dangling edges, no cycles) and persist a new
   * workflow in `draft`. Rejects cycles with the offending task ids.
   */
  async createWorkflow(input: CreateWorkflowInput): Promise<Workflow> {
    const parsed = CreateWorkflowInputSchema.parse(input)

    const ids = parsed.tasks.map((t) => t.id)
    const duplicate = ids.find((id, i) => ids.indexOf(id) !== i)
    if (duplicate !== undefined) {
      throw new InvalidTaskStateError(`Duplicate task id in workflow: "${duplicate}".`, {
        taskId: duplicate
      })
    }

    const graph = parsed.tasks.map((t) => ({
      id: t.id,
      dependsOn: t.dependsOn,
      status: 'blocked' as const,
      createdAt: 0
    }))
    const missing = findMissingDependencies(graph)
    if (missing.length > 0) {
      throw new InvalidTaskStateError('Workflow has dependencies on unknown task ids.', { missing })
    }
    const cycle = detectCycle(graph)
    if (cycle.length > 0) throw new WorkflowCycleError(cycle)

    const baseBranch = parsed.baseBranch ?? (await this.resolveBase(parsed.repoPath))
    const createdAt = this.now()
    const workflow: Workflow = {
      id: randomUUID(),
      name: parsed.name,
      repoPath: parsed.repoPath,
      baseBranch,
      status: 'draft',
      maxConcurrency: parsed.maxConcurrency,
      createdAt,
      tasks: parsed.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        prompt: t.prompt,
        dependsOn: t.dependsOn,
        status: 'blocked',
        agentId: null,
        retryCount: 0,
        createdAt,
        startedAt: null,
        finishedAt: null,
        failureReason: null
      }))
    }
    this.store.create(workflow)
    log.info('scheduler.workflow-created', {
      workflowId: workflow.id,
      tasks: workflow.tasks.length
    })
    return this.emitSnapshot(workflow.id)
  }

  // --- run control ---------------------------------------------------------

  async startWorkflow(id: string): Promise<Workflow> {
    this.requireWorkflow(id)
    this.store.setWorkflowStatus(id, 'running')
    this.progress(id)
    return this.emitSnapshot(id)
  }

  pauseWorkflow(id: string): Workflow {
    this.requireWorkflow(id)
    // Running agents finish; the spawn loop refuses to start new ones while paused.
    this.store.setWorkflowStatus(id, 'paused')
    return this.emitSnapshot(id)
  }

  async resumeWorkflow(id: string): Promise<Workflow> {
    this.requireWorkflow(id)
    this.store.setWorkflowStatus(id, 'running')
    this.progress(id)
    return this.emitSnapshot(id)
  }

  // --- review actions ------------------------------------------------------

  /** Approve a completed task's diff: merge it (serially), then release children. */
  async approveTask(workflowId: string, taskId: string): Promise<Workflow> {
    const { wf, task } = this.require(workflowId, taskId)
    if (task.status !== 'completed') {
      throw new InvalidTaskStateError(
        `Task "${taskId}" is ${task.status}, not completed; only completed tasks can be approved.`,
        { workflowId, taskId, status: task.status }
      )
    }
    // Serialize merges per repo — never two merges into the same base at once.
    await this.enqueueMerge(wf.repoPath, () => this.runner.mergeTask(task, wf))
    this.patchTask(workflowId, taskId, { status: 'merged' })
    log.info('scheduler.task-merged', { workflowId, taskId })
    this.progress(workflowId)
    return this.emitSnapshot(workflowId)
  }

  /**
   * Reject a completed task's diff.
   *  - `cascade` (default): task -> rejected, every transitive descendant -> cancelled.
   *  - `retry`: re-queue the SAME task (optionally with an edited prompt), no cascade.
   */
  async rejectTask(
    workflowId: string,
    taskId: string,
    mode: 'cascade' | 'retry' = 'cascade',
    prompt?: string
  ): Promise<Workflow> {
    const { wf, task } = this.require(workflowId, taskId)
    if (task.status !== 'completed') {
      throw new InvalidTaskStateError(
        `Task "${taskId}" is ${task.status}, not completed; only completed tasks can be rejected.`,
        { workflowId, taskId, status: task.status }
      )
    }
    await this.runner.discardTask(task, wf)

    if (mode === 'retry') {
      this.patchTask(workflowId, taskId, {
        status: 'blocked',
        agentId: null,
        startedAt: null,
        finishedAt: null,
        failureReason: null,
        ...(prompt !== undefined ? { prompt } : {})
      })
      log.info('scheduler.task-reject-retry', { workflowId, taskId })
      this.progress(workflowId)
      return this.emitSnapshot(workflowId)
    }

    const toCancel = descendants(wf.tasks, taskId)
    this.patchTask(workflowId, taskId, { status: 'rejected', finishedAt: this.now() })
    for (const id of toCancel) {
      const child = wf.tasks.find((t) => t.id === id)
      if (child && !TERMINAL_TASK_STATUSES.includes(child.status)) {
        await this.runner.discardTask(child, wf)
        this.patchTask(workflowId, id, { status: 'cancelled', finishedAt: this.now() })
      }
    }
    log.info('scheduler.task-rejected', { workflowId, taskId, cancelled: toCancel.length })
    this.progress(workflowId)
    return this.emitSnapshot(workflowId)
  }

  /** Manually retry a failed task (re-queue it; downstream was left blocked). */
  async retryTask(workflowId: string, taskId: string): Promise<Workflow> {
    const { wf, task } = this.require(workflowId, taskId)
    if (task.status !== 'failed') {
      throw new InvalidTaskStateError(
        `Task "${taskId}" is ${task.status}, not failed; only failed tasks can be retried.`,
        { workflowId, taskId, status: task.status }
      )
    }
    await this.runner.discardTask(task, wf)
    this.patchTask(workflowId, taskId, {
      status: 'blocked',
      agentId: null,
      startedAt: null,
      finishedAt: null,
      failureReason: null
    })
    log.info('scheduler.task-retry', { workflowId, taskId })
    this.progress(workflowId)
    return this.emitSnapshot(workflowId)
  }

  // --- agent lifecycle callbacks (wired from the supervisor / mock) ---------

  /** An agent finished its turn: the task's diff now awaits review. */
  onAgentCompleted(workspaceId: string): void {
    const hit = this.findByAgent(workspaceId)
    if (!hit || hit.task.status !== 'running') return
    this.patchTask(hit.workflowId, hit.task.id, { status: 'completed', finishedAt: this.now() })
    log.info('scheduler.task-completed', { workflowId: hit.workflowId, taskId: hit.task.id })
    // Completing frees a concurrency slot (the agent is no longer running).
    this.progress(hit.workflowId)
    this.emitSnapshot(hit.workflowId)
  }

  /** An agent crashed/errored: auto-retry once, then leave failed for manual retry. */
  onAgentFailed(workspaceId: string, reason: string): void {
    const hit = this.findByAgent(workspaceId)
    if (!hit || hit.task.status !== 'running') return
    this.handleFailure(hit.workflowId, hit.task.id, reason)
  }

  /**
   * Recover after an app restart: running agents are gone, so previously-running
   * tasks become `failed`/"interrupted" (graph otherwise intact, retryable), and
   * any workflow that was `running` is `paused` so nothing auto-spawns on boot.
   */
  recover(): void {
    for (const wf of this.store.list()) {
      let touched = false
      for (const task of wf.tasks) {
        if (task.status === 'running') {
          this.patchTask(wf.id, task.id, {
            status: 'failed',
            failureReason: 'interrupted',
            finishedAt: this.now()
          })
          touched = true
        }
      }
      if (wf.status === 'running') {
        this.store.setWorkflowStatus(wf.id, 'paused')
        touched = true
      }
      if (touched) {
        log.warn('scheduler.recovered-workflow', { workflowId: wf.id })
        this.emitSnapshot(wf.id)
      }
    }
  }

  // --- internals -----------------------------------------------------------

  /** Promote newly-eligible tasks to ready, spawn up to the cap, check completion. */
  private progress(workflowId: string): void {
    this.promote(workflowId)
    this.tick(workflowId)
    this.checkCompletion(workflowId)
  }

  /** blocked -> ready for every task whose dependencies are now all merged. */
  private promote(workflowId: string): void {
    const wf = this.store.get(workflowId)
    if (!wf) return
    for (const id of computeReady(wf.tasks)) {
      this.patchTask(workflowId, id, { status: 'ready' })
    }
  }

  /** Spawn FIFO-oldest ready tasks until the concurrency cap is hit. */
  private tick(workflowId: string): void {
    const wf = this.store.get(workflowId)
    if (!wf || wf.status !== 'running') return

    const running = wf.tasks.filter((t) => t.status === 'running').length
    let slots = wf.maxConcurrency - running
    if (slots <= 0) return

    for (const taskId of fifoReadyOrder(wf.tasks)) {
      if (slots <= 0) break
      // Mark running synchronously so concurrency accounting is race-free before
      // the async spawn; agentId is filled in when spawnAgent resolves.
      this.patchTask(workflowId, taskId, {
        status: 'running',
        agentId: null,
        startedAt: this.now()
      })
      slots--
      void this.spawn(workflowId, taskId)
    }
  }

  private async spawn(workflowId: string, taskId: string): Promise<void> {
    const wf = this.store.get(workflowId)
    const task = wf?.tasks.find((t) => t.id === taskId)
    if (!wf || !task) return
    try {
      const { workspaceId } = await this.runner.spawnAgent(task, wf)
      this.patchTask(workflowId, taskId, { agentId: workspaceId })
      log.info('scheduler.task-spawned', { workflowId, taskId, workspaceId })
      this.emitSnapshot(workflowId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('scheduler.spawn-failed', { workflowId, taskId, message })
      // A spawn failure is handled exactly like an agent failure.
      this.handleFailure(workflowId, taskId, `spawn failed: ${message}`)
    }
  }

  private handleFailure(workflowId: string, taskId: string, reason: string): void {
    const wf = this.store.get(workflowId)
    const task = wf?.tasks.find((t) => t.id === taskId)
    if (!wf || !task) return
    if (task.retryCount < 1) {
      // One automatic retry: reset so promote()/tick() re-run it, spend the budget.
      this.patchTask(workflowId, taskId, {
        status: 'blocked',
        agentId: null,
        startedAt: null,
        finishedAt: null,
        failureReason: null,
        retryCount: task.retryCount + 1
      })
      log.warn('scheduler.task-auto-retry', { workflowId, taskId })
    } else {
      this.patchTask(workflowId, taskId, {
        status: 'failed',
        failureReason: reason,
        finishedAt: this.now()
      })
      log.warn('scheduler.task-failed', { workflowId, taskId, reason })
    }
    this.progress(workflowId)
    this.emitSnapshot(workflowId)
  }

  private checkCompletion(workflowId: string): void {
    const wf = this.store.get(workflowId)
    if (!wf || wf.status === 'completed' || wf.status === 'failed') return
    const allTerminal = wf.tasks.every((t) => TERMINAL_TASK_STATUSES.includes(t.status))
    if (!allTerminal) return
    const anyFailed = wf.tasks.some((t) => t.status === 'failed')
    this.store.setWorkflowStatus(workflowId, anyFailed ? 'failed' : 'completed')
    log.info('scheduler.workflow-finished', { workflowId, failed: anyFailed })
  }

  private patchTask(workflowId: string, taskId: string, patch: Partial<Task>): void {
    const wf = this.store.get(workflowId)
    const task = wf?.tasks.find((t) => t.id === taskId)
    if (!task) return
    this.store.saveTask(workflowId, { ...task, ...patch })
  }

  private findByAgent(workspaceId: string): { workflowId: string; task: Task } | undefined {
    for (const wf of this.store.list()) {
      const task = wf.tasks.find((t) => t.agentId === workspaceId)
      if (task) return { workflowId: wf.id, task }
    }
    return undefined
  }

  private require(workflowId: string, taskId: string): { wf: Workflow; task: Task } {
    const wf = this.requireWorkflow(workflowId)
    const task = wf.tasks.find((t) => t.id === taskId)
    if (!task) throw new TaskNotFoundError(workflowId, taskId)
    return { wf, task }
  }

  private requireWorkflow(id: string): Workflow {
    const wf = this.store.get(id)
    if (!wf) throw new WorkflowNotFoundError(id)
    return wf
  }

  private async resolveBase(repoPath: string): Promise<string> {
    if (this.resolveBaseBranch) return this.resolveBaseBranch(repoPath)
    throw new InvalidTaskStateError('No baseBranch provided and no resolver configured.', {
      repoPath
    })
  }

  /** Append `fn` to this repo's merge chain; runs after prior merges settle. */
  private enqueueMerge<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.mergeChains.get(key) ?? Promise.resolve()
    const result = prev.then(fn, fn)
    // Keep the chain alive but swallow errors so one failed merge can't wedge it.
    this.mergeChains.set(
      key,
      result.then(
        () => undefined,
        () => undefined
      )
    )
    return result
  }

  private emitSnapshot(workflowId: string): Workflow {
    const wf = this.requireWorkflow(workflowId)
    if (this.emitFn) this.emitFn(wf)
    return wf
  }
}
