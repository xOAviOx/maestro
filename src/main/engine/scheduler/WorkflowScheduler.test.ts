import { beforeEach, describe, expect, it } from 'vitest'
import type { NewTaskInput, Task, Workflow, WorkflowStatus } from '@shared/types'
import { MergeConflictError } from '../errors'
import { WorkflowScheduler, type WorkflowRepository } from './WorkflowScheduler'
import type { ReviewPrep, TaskRunner } from './TaskRunner'

/** JSON deep-clone (Task/Workflow are plain JSON-safe data with nulls). */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** In-memory store — keeps the scheduler tests free of native better-sqlite3. */
class FakeStore implements WorkflowRepository {
  private readonly map = new Map<string, Workflow>()

  create(workflow: Workflow): void {
    this.map.set(workflow.id, clone(workflow))
  }
  get(id: string): Workflow | undefined {
    const wf = this.map.get(id)
    return wf ? clone(wf) : undefined
  }
  list(): Workflow[] {
    return [...this.map.values()].map((w) => clone(w))
  }
  setWorkflowStatus(id: string, status: WorkflowStatus): void {
    const wf = this.map.get(id)
    if (wf) wf.status = status
  }
  saveTask(workflowId: string, task: Task): void {
    const wf = this.map.get(workflowId)
    if (!wf) return
    const i = wf.tasks.findIndex((t) => t.id === task.id)
    if (i >= 0) wf.tasks[i] = clone(task)
  }
}

/** Records calls; never auto-completes — tests drive completion/failure explicitly. */
class FakeRunner implements TaskRunner {
  readonly spawns: string[] = []
  readonly merges: string[] = []
  readonly discards: string[] = []
  readonly prepares: string[] = []
  private n = 0
  /** When set, `prepareForReview` reports these files as a rebase conflict. */
  prepareConflict: string[] | null = null
  /** When set, `mergeTask` throws a MergeConflictError for these files instead of merging. */
  mergeConflict: string[] | null = null

  async spawnAgent(task: Task): Promise<{ workspaceId: string }> {
    this.spawns.push(task.id)
    this.n += 1
    return { workspaceId: `ws-${task.id}-${this.n}` }
  }
  async prepareForReview(task: Task): Promise<ReviewPrep> {
    this.prepares.push(task.id)
    if (this.prepareConflict) return { rebased: false, conflict: { files: this.prepareConflict } }
    // No real worktree in these tests: nothing to rebase, never a conflict.
    return { rebased: false, conflict: null }
  }
  async mergeTask(task: Task): Promise<void> {
    if (this.mergeConflict) throw new MergeConflictError(this.mergeConflict, {})
    this.merges.push(task.id)
  }
  async discardTask(task: Task): Promise<void> {
    this.discards.push(task.id)
  }
}

/** Flush pending microtasks + timers so async spawns settle before assertions. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function task(scheduler: WorkflowScheduler, wfId: string, taskId: string): Task {
  const t = scheduler.getWorkflow(wfId).tasks.find((x) => x.id === taskId)
  if (!t) throw new Error(`missing task ${taskId}`)
  return t
}

function statuses(scheduler: WorkflowScheduler, wfId: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const t of scheduler.getWorkflow(wfId).tasks) out[t.id] = t.status
  return out
}

function runningCount(scheduler: WorkflowScheduler, wfId: string): number {
  return scheduler.getWorkflow(wfId).tasks.filter((t) => t.status === 'running').length
}

/** Complete + approve (merge) a running task, by id. */
async function mergeTask(scheduler: WorkflowScheduler, wfId: string, taskId: string): Promise<void> {
  const ws = task(scheduler, wfId, taskId).agentId
  if (!ws) throw new Error(`task ${taskId} has no agent to complete`)
  scheduler.onAgentCompleted(ws)
  await scheduler.approveTask(wfId, taskId)
  await flush()
}

const DIAMOND: NewTaskInput[] = [
  { id: 'a', title: 'A', prompt: 'pa', dependsOn: [] },
  { id: 'b', title: 'B', prompt: 'pb', dependsOn: ['a'] },
  { id: 'c', title: 'C', prompt: 'pc', dependsOn: ['a'] },
  { id: 'd', title: 'D', prompt: 'pd', dependsOn: ['b', 'c'] }
]

describe('WorkflowScheduler', () => {
  let store: FakeStore
  let runner: FakeRunner
  let scheduler: WorkflowScheduler

  beforeEach(() => {
    store = new FakeStore()
    runner = new FakeRunner()
    scheduler = new WorkflowScheduler({ store, runner })
  })

  async function createWorkflow(
    tasks: NewTaskInput[],
    maxConcurrency = 3
  ): Promise<Workflow> {
    return scheduler.createWorkflow({
      name: 'wf',
      repoPath: '/repo',
      baseBranch: 'main',
      maxConcurrency,
      tasks
    })
  }

  it('rejects a workflow containing a cycle, naming the offending tasks', async () => {
    await expect(
      createWorkflow([
        { id: 'a', title: 'A', prompt: 'p', dependsOn: ['b'] },
        { id: 'b', title: 'B', prompt: 'p', dependsOn: ['a'] }
      ])
    ).rejects.toMatchObject({ code: 'WORKFLOW_CYCLE' })
  })

  it('rejects a workflow with a dependency on an unknown task', async () => {
    await expect(
      createWorkflow([{ id: 'a', title: 'A', prompt: 'p', dependsOn: ['ghost'] }])
    ).rejects.toMatchObject({ code: 'INVALID_TASK_STATE' })
  })

  it('starts a workflow with only dependency-free tasks running', async () => {
    const wf = await createWorkflow(DIAMOND)
    await scheduler.startWorkflow(wf.id)
    await flush()

    expect(statuses(scheduler, wf.id)).toEqual({
      a: 'running',
      b: 'blocked',
      c: 'blocked',
      d: 'blocked'
    })
    expect(task(scheduler, wf.id, 'a').agentId).toBeTruthy()
    expect(runner.spawns).toEqual(['a'])
  })

  it('runs a diamond in dependency order; D spawns only after B and C both merge', async () => {
    const wf = await createWorkflow(DIAMOND)
    await scheduler.startWorkflow(wf.id)
    await flush()

    await mergeTask(scheduler, wf.id, 'a')
    // A merged unlocks B and C together (concurrency 3 fits both).
    expect(statuses(scheduler, wf.id)).toMatchObject({ b: 'running', c: 'running', d: 'blocked' })
    expect(runner.spawns).toEqual(['a', 'b', 'c'])

    await mergeTask(scheduler, wf.id, 'b')
    // Only B merged so far — D must still wait on C.
    expect(task(scheduler, wf.id, 'd').status).toBe('blocked')

    await mergeTask(scheduler, wf.id, 'c')
    // Now both parents merged — D spawns, and it spawned LAST.
    expect(task(scheduler, wf.id, 'd').status).toBe('running')
    expect(runner.spawns).toEqual(['a', 'b', 'c', 'd'])

    await mergeTask(scheduler, wf.id, 'd')
    expect(statuses(scheduler, wf.id)).toEqual({
      a: 'merged',
      b: 'merged',
      c: 'merged',
      d: 'merged'
    })
    expect(scheduler.getWorkflow(wf.id).status).toBe('completed')
  })

  it("D's parents both merge before D runs (fresh-base ordering guarantee)", async () => {
    const wf = await createWorkflow(DIAMOND)
    await scheduler.startWorkflow(wf.id)
    await flush()
    await mergeTask(scheduler, wf.id, 'a')
    await mergeTask(scheduler, wf.id, 'b')
    await mergeTask(scheduler, wf.id, 'c')
    // D spawns strictly after b and c appear in the merge log.
    expect(runner.merges).toEqual(['a', 'b', 'c'])
    expect(runner.spawns.indexOf('d')).toBeGreaterThan(runner.spawns.indexOf('b'))
    expect(runner.spawns.indexOf('d')).toBeGreaterThan(runner.spawns.indexOf('c'))
  })

  it('never exceeds maxConcurrency running agents', async () => {
    const wf = await createWorkflow(
      [
        { id: 'i1', title: 'I1', prompt: 'p', dependsOn: [] },
        { id: 'i2', title: 'I2', prompt: 'p', dependsOn: [] },
        { id: 'i3', title: 'I3', prompt: 'p', dependsOn: [] }
      ],
      2
    )
    await scheduler.startWorkflow(wf.id)
    await flush()

    expect(runningCount(scheduler, wf.id)).toBe(2)
    expect(runner.spawns).toHaveLength(2)

    // Freeing a slot lets the third start — but still never more than 2 at once.
    await mergeTask(scheduler, wf.id, runner.spawns[0] as string)
    expect(runningCount(scheduler, wf.id)).toBeLessThanOrEqual(2)
    expect(runner.spawns).toHaveLength(3)
  })

  it('spawns ready tasks FIFO (insertion order) when the cap is 1', async () => {
    const wf = await createWorkflow(
      [
        { id: 'f1', title: 'F1', prompt: 'p', dependsOn: [] },
        { id: 'f2', title: 'F2', prompt: 'p', dependsOn: [] },
        { id: 'f3', title: 'F3', prompt: 'p', dependsOn: [] }
      ],
      1
    )
    await scheduler.startWorkflow(wf.id)
    await flush()
    expect(runner.spawns).toEqual(['f1'])

    await mergeTask(scheduler, wf.id, 'f1')
    expect(runner.spawns).toEqual(['f1', 'f2'])

    await mergeTask(scheduler, wf.id, 'f2')
    expect(runner.spawns).toEqual(['f1', 'f2', 'f3'])
  })

  it('cascades a rejection to all transitive descendants', async () => {
    const wf = await createWorkflow([
      { id: 'a', title: 'A', prompt: 'p', dependsOn: [] },
      { id: 'b', title: 'B', prompt: 'p', dependsOn: ['a'] },
      { id: 'c', title: 'C', prompt: 'p', dependsOn: ['b'] }
    ])
    await scheduler.startWorkflow(wf.id)
    await flush()
    await mergeTask(scheduler, wf.id, 'a')
    scheduler.onAgentCompleted(task(scheduler, wf.id, 'b').agentId as string)

    expect(scheduler.previewCascade(wf.id, 'b')).toEqual(['c'])

    await scheduler.rejectTask(wf.id, 'b', 'cascade')
    expect(statuses(scheduler, wf.id)).toEqual({ a: 'merged', b: 'rejected', c: 'cancelled' })
    expect(scheduler.getWorkflow(wf.id).status).toBe('completed')
  })

  it("reject-and-retry re-queues the same task with an edited prompt, no cascade", async () => {
    const wf = await createWorkflow([
      { id: 'a', title: 'A', prompt: 'p', dependsOn: [] },
      { id: 'b', title: 'B', prompt: 'orig', dependsOn: ['a'] }
    ])
    await scheduler.startWorkflow(wf.id)
    await flush()
    await mergeTask(scheduler, wf.id, 'a')
    scheduler.onAgentCompleted(task(scheduler, wf.id, 'b').agentId as string)

    await scheduler.rejectTask(wf.id, 'b', 'retry', 'edited prompt')
    await flush()

    const b = task(scheduler, wf.id, 'b')
    expect(b.status).toBe('running')
    expect(b.prompt).toBe('edited prompt')
    expect(runner.spawns).toEqual(['a', 'b', 'b'])
  })

  it('auto-retries a failed agent once, then leaves it failed; downstream stays blocked', async () => {
    const wf = await createWorkflow([
      { id: 'a', title: 'A', prompt: 'p', dependsOn: [] },
      { id: 'b', title: 'B', prompt: 'p', dependsOn: ['a'] }
    ])
    await scheduler.startWorkflow(wf.id)
    await flush()

    // First failure -> automatic retry (re-spawn).
    scheduler.onAgentFailed(task(scheduler, wf.id, 'a').agentId as string, 'boom')
    await flush()
    expect(task(scheduler, wf.id, 'a').status).toBe('running')
    expect(task(scheduler, wf.id, 'a').retryCount).toBe(1)
    expect(runner.spawns).toEqual(['a', 'a'])

    // Second failure -> stays failed (manual only); child B is NOT cancelled.
    scheduler.onAgentFailed(task(scheduler, wf.id, 'a').agentId as string, 'boom again')
    await flush()
    expect(task(scheduler, wf.id, 'a').status).toBe('failed')
    expect(task(scheduler, wf.id, 'a').failureReason).toBe('boom again')
    expect(task(scheduler, wf.id, 'b').status).toBe('blocked')
    expect(scheduler.getWorkflow(wf.id).status).toBe('running')

    // Manual retry re-runs it.
    await scheduler.retryTask(wf.id, 'a')
    await flush()
    expect(task(scheduler, wf.id, 'a').status).toBe('running')
  })

  it('keeps independent subgraphs unaffected by a failure in another', async () => {
    const wf = await createWorkflow(
      [
        { id: 'a', title: 'A', prompt: 'p', dependsOn: [] },
        { id: 'x', title: 'X', prompt: 'p', dependsOn: [] }
      ],
      2
    )
    await scheduler.startWorkflow(wf.id)
    await flush()

    // Fail 'a' twice; 'x' should keep running untouched.
    scheduler.onAgentFailed(task(scheduler, wf.id, 'a').agentId as string, 'boom')
    await flush()
    scheduler.onAgentFailed(task(scheduler, wf.id, 'a').agentId as string, 'boom')
    await flush()

    expect(task(scheduler, wf.id, 'a').status).toBe('failed')
    expect(task(scheduler, wf.id, 'x').status).toBe('running')
  })

  it('recovers after a restart: running tasks become failed/interrupted and the workflow pauses', async () => {
    const wf = await createWorkflow(DIAMOND)
    await scheduler.startWorkflow(wf.id)
    await flush()
    expect(task(scheduler, wf.id, 'a').status).toBe('running')

    // Simulate an app restart: a brand-new scheduler over the SAME persisted store.
    const recovered = new WorkflowScheduler({ store, runner: new FakeRunner() })
    recovered.recover()

    expect(recovered.getWorkflow(wf.id).status).toBe('paused')
    expect(task(recovered, wf.id, 'a').status).toBe('failed')
    expect(task(recovered, wf.id, 'a').failureReason).toBe('interrupted')
    expect(task(recovered, wf.id, 'b').status).toBe('blocked')
  })

  // --- Phase 1.2: rebase-on-complete + merge-conflict queue blocking -------

  it('records a rebase conflict on complete and blocks the merge until resolved', async () => {
    const wf = await createWorkflow([{ id: 'a', title: 'A', prompt: 'p', dependsOn: [] }])
    await scheduler.startWorkflow(wf.id)
    await flush()

    // Agent finishes, but rebasing its worktree onto base conflicts.
    runner.prepareConflict = ['x.txt']
    scheduler.onAgentCompleted(task(scheduler, wf.id, 'a').agentId as string)
    await flush()

    const a = task(scheduler, wf.id, 'a')
    expect(a.status).toBe('completed')
    expect(a.conflict).toMatchObject({ kind: 'rebase', files: ['x.txt'] })

    // Approving retries the rebase; still conflicting -> refused, nothing merged.
    await expect(scheduler.approveTask(wf.id, 'a')).rejects.toMatchObject({ code: 'MERGE_CONFLICT' })
    expect(runner.merges).toEqual([])

    // User resolves the worktree; the next approve rebases clean and merges.
    runner.prepareConflict = null
    await scheduler.approveTask(wf.id, 'a')
    expect(task(scheduler, wf.id, 'a').status).toBe('merged')
    expect(task(scheduler, wf.id, 'a').conflict).toBeNull()
    expect(runner.merges).toEqual(['a'])
  })

  it('a merge conflict blocks the repo merge queue for OTHER tasks until resolved', async () => {
    const wf = await createWorkflow(
      [
        { id: 'i1', title: 'I1', prompt: 'p', dependsOn: [] },
        { id: 'i2', title: 'I2', prompt: 'p', dependsOn: [] }
      ],
      2
    )
    await scheduler.startWorkflow(wf.id)
    await flush()
    scheduler.onAgentCompleted(task(scheduler, wf.id, 'i1').agentId as string)
    scheduler.onAgentCompleted(task(scheduler, wf.id, 'i2').agentId as string)
    await flush()

    // i1's merge conflicts: it records the sub-state and blocks the queue.
    runner.mergeConflict = ['shared.txt']
    await expect(scheduler.approveTask(wf.id, 'i1')).rejects.toMatchObject({ code: 'MERGE_CONFLICT' })
    expect(task(scheduler, wf.id, 'i1').conflict).toMatchObject({ kind: 'merge' })

    // A DIFFERENT task cannot merge past the block.
    await expect(scheduler.approveTask(wf.id, 'i2')).rejects.toMatchObject({
      code: 'INVALID_TASK_STATE',
      details: { blockedBy: { taskId: 'i1' } }
    })
    expect(runner.merges).toEqual([])

    // Resolve i1 (its own re-approval bypasses the block); the queue frees.
    runner.mergeConflict = null
    await scheduler.approveTask(wf.id, 'i1')
    expect(task(scheduler, wf.id, 'i1').status).toBe('merged')
    await scheduler.approveTask(wf.id, 'i2')
    expect(task(scheduler, wf.id, 'i2').status).toBe('merged')
    expect(runner.merges).toEqual(['i1', 'i2'])
  })

  it('rejecting the conflicted blocker releases the merge queue', async () => {
    const wf = await createWorkflow(
      [
        { id: 'i1', title: 'I1', prompt: 'p', dependsOn: [] },
        { id: 'i2', title: 'I2', prompt: 'p', dependsOn: [] }
      ],
      2
    )
    await scheduler.startWorkflow(wf.id)
    await flush()
    scheduler.onAgentCompleted(task(scheduler, wf.id, 'i1').agentId as string)
    scheduler.onAgentCompleted(task(scheduler, wf.id, 'i2').agentId as string)
    await flush()

    runner.mergeConflict = ['shared.txt']
    await expect(scheduler.approveTask(wf.id, 'i1')).rejects.toMatchObject({ code: 'MERGE_CONFLICT' })

    // Reject i1 instead of resolving — this must unblock the queue for i2.
    runner.mergeConflict = null
    await scheduler.rejectTask(wf.id, 'i1', 'cascade')
    expect(task(scheduler, wf.id, 'i1').status).toBe('rejected')

    await scheduler.approveTask(wf.id, 'i2')
    expect(task(scheduler, wf.id, 'i2').status).toBe('merged')
  })

  it('re-derives the merge-queue block from persisted conflict state after a restart', async () => {
    const wf = await createWorkflow(
      [
        { id: 'i1', title: 'I1', prompt: 'p', dependsOn: [] },
        { id: 'i2', title: 'I2', prompt: 'p', dependsOn: [] }
      ],
      2
    )
    await scheduler.startWorkflow(wf.id)
    await flush()
    scheduler.onAgentCompleted(task(scheduler, wf.id, 'i1').agentId as string)
    scheduler.onAgentCompleted(task(scheduler, wf.id, 'i2').agentId as string)
    await flush()

    runner.mergeConflict = ['shared.txt']
    await expect(scheduler.approveTask(wf.id, 'i1')).rejects.toMatchObject({ code: 'MERGE_CONFLICT' })

    // Restart over the SAME store: the block lives only in memory, so recover()
    // must rebuild it from the persisted `conflict` field or a sibling could
    // silently merge past the unresolved conflict.
    const recovered = new WorkflowScheduler({ store, runner: new FakeRunner() })
    recovered.recover()
    await expect(recovered.approveTask(wf.id, 'i2')).rejects.toMatchObject({
      code: 'INVALID_TASK_STATE',
      details: { blockedBy: { taskId: 'i1' } }
    })
  })
})
