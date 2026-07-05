import type { Task, Workflow } from '@shared/types'
import type { Engine } from '../index'
import type { WorkspaceSupervisor } from '../WorkspaceSupervisor'
import { InvalidTaskStateError } from '../errors'

/**
 * The two side-effecting operations the scheduler needs, abstracted so its DAG
 * logic can be unit-tested with a fake, and so the acceptance smoke can drive
 * real git worktrees/merges with a *mock agent* (sleep-then-write-a-file) in
 * place of a real Claude Code process.
 *
 * Agent completion/failure is NOT reported through this interface — it arrives
 * out-of-band via `WorkflowScheduler.onAgentCompleted/onAgentFailed`, which the
 * real system wires from `WorkspaceSupervisor` status events and the mock wires
 * from its timer.
 */
export interface TaskRunner {
  /** Create the task's worktree and start its agent. Returns the linked workspace id. */
  spawnAgent(task: Task, workflow: Workflow): Promise<{ workspaceId: string }>
  /** Merge the task's workspace into the workflow base. Throws on conflict/failure. */
  mergeTask(task: Task, workflow: Workflow): Promise<void>
  /** Tear down a task's worktree (rejection/cancel/retry cleanup). Best-effort. */
  discardTask(task: Task, workflow: Workflow): Promise<void>
}

/**
 * Real runner backed by the engine + supervisor. Fully exercised end-to-end in
 * Phase 1.2 (real agents); in Phase 1.1 the acceptance smoke uses a mock runner
 * instead, but this is shipped and type-checked so 1.2 only has to wire it in.
 */
export class EngineTaskRunner implements TaskRunner {
  private readonly engine: Engine
  private readonly supervisor: WorkspaceSupervisor

  constructor(engine: Engine, supervisor: WorkspaceSupervisor) {
    this.engine = engine
    this.supervisor = supervisor
  }

  async spawnAgent(task: Task, workflow: Workflow): Promise<{ workspaceId: string }> {
    // A fresh worktree off the CURRENT base branch — so a dependent task's agent
    // sees its parents' already-merged changes (spec rule 4).
    const ws = await this.engine.worktrees.createWorkspace({
      repoPath: workflow.repoPath,
      name: task.title,
      baseBranch: workflow.baseBranch,
      agentType: 'claude-code'
    })
    await this.supervisor.startRun(ws.id, task.prompt)
    return { workspaceId: ws.id }
  }

  async mergeTask(task: Task, workflow: Workflow): Promise<void> {
    if (!task.agentId) {
      throw new InvalidTaskStateError(`Task "${task.id}" has no workspace to merge.`, {
        workflowId: workflow.id,
        taskId: task.id
      })
    }
    await this.engine.worktrees.mergeWorkspace(task.agentId, {
      commitMessage: `Maestro: ${task.title}`,
      archiveAfter: true
    })
  }

  async discardTask(task: Task): Promise<void> {
    if (!task.agentId) return
    try {
      await this.engine.worktrees.archiveWorkspace(task.agentId, true)
    } catch {
      // Best-effort cleanup — a stuck worktree shouldn't block the DAG.
    }
  }
}
