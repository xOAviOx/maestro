import type { Db } from './Database'
import { TaskConflictSchema } from '@shared/types'
import type { Task, TaskConflict, TaskStatus, Workflow, WorkflowStatus } from '@shared/types'

interface WorkflowRow {
  id: string
  name: string
  repo_path: string
  base_branch: string
  status: string
  max_concurrency: number
  created_at: number
}

interface TaskRow {
  workflow_id: string
  id: string
  title: string
  prompt: string
  depends_on: string
  status: string
  agent_id: string | null
  retry_count: number
  conflict: string | null
  created_at: number
  started_at: number | null
  finished_at: number | null
  failure_reason: string | null
}

function parseDependsOn(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json)
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    // fall through to empty
  }
  return []
}

/** Parse the persisted conflict JSON; malformed/legacy content degrades to null. */
function parseConflict(json: string | null): TaskConflict | null {
  if (!json) return null
  try {
    const parsed = TaskConflictSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    dependsOn: parseDependsOn(row.depends_on),
    status: row.status as TaskStatus,
    agentId: row.agent_id,
    retryCount: row.retry_count,
    conflict: parseConflict(row.conflict),
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    failureReason: row.failure_reason
  }
}

/**
 * Persistence for workflows + their tasks (Module 9 DAG scheduler).
 *
 * The scheduler treats this store as the single source of truth so state
 * survives an app restart: on relaunch the graph is read straight back and
 * previously-`running` tasks are recovered as `failed`/interrupted. Tasks are
 * returned in insertion order (rowid) so FIFO tie-breaking is deterministic.
 */
export class WorkflowStore {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  /** Insert a workflow and all of its tasks atomically. */
  create(workflow: Workflow): void {
    const insertWorkflow = this.db.prepare(
      `INSERT INTO workflows (id, name, repo_path, base_branch, status, max_concurrency, created_at)
       VALUES (@id, @name, @repoPath, @baseBranch, @status, @maxConcurrency, @createdAt)`
    )
    const insertTask = this.db.prepare(
      `INSERT INTO tasks
         (workflow_id, id, title, prompt, depends_on, status, agent_id, retry_count,
          conflict, created_at, started_at, finished_at, failure_reason)
       VALUES
         (@workflowId, @id, @title, @prompt, @dependsOn, @status, @agentId, @retryCount,
          @conflict, @createdAt, @startedAt, @finishedAt, @failureReason)`
    )
    const tx = this.db.transaction((wf: Workflow) => {
      insertWorkflow.run({
        id: wf.id,
        name: wf.name,
        repoPath: wf.repoPath,
        baseBranch: wf.baseBranch,
        status: wf.status,
        maxConcurrency: wf.maxConcurrency,
        createdAt: wf.createdAt
      })
      for (const t of wf.tasks) insertTask.run(this.taskParams(wf.id, t))
    })
    tx(workflow)
  }

  get(id: string): Workflow | undefined {
    const row = this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as
      | WorkflowRow
      | undefined
    if (!row) return undefined
    return this.hydrate(row)
  }

  list(): Workflow[] {
    const rows = this.db
      .prepare('SELECT * FROM workflows ORDER BY created_at DESC')
      .all() as WorkflowRow[]
    return rows.map((r) => this.hydrate(r))
  }

  setWorkflowStatus(id: string, status: WorkflowStatus): void {
    this.db.prepare('UPDATE workflows SET status = ? WHERE id = ?').run(status, id)
  }

  /** Persist every mutable field of a single task. */
  saveTask(workflowId: string, task: Task): void {
    this.db
      .prepare(
        `UPDATE tasks
           SET title = @title, prompt = @prompt, depends_on = @dependsOn, status = @status,
               agent_id = @agentId, retry_count = @retryCount, conflict = @conflict,
               started_at = @startedAt, finished_at = @finishedAt,
               failure_reason = @failureReason
         WHERE workflow_id = @workflowId AND id = @id`
      )
      .run(this.taskParams(workflowId, task))
  }

  // --- internals ---

  private hydrate(row: WorkflowRow): Workflow {
    const taskRows = this.db
      .prepare('SELECT * FROM tasks WHERE workflow_id = ? ORDER BY rowid ASC')
      .all(row.id) as TaskRow[]
    return {
      id: row.id,
      name: row.name,
      repoPath: row.repo_path,
      baseBranch: row.base_branch,
      status: row.status as WorkflowStatus,
      maxConcurrency: row.max_concurrency,
      tasks: taskRows.map(rowToTask),
      createdAt: row.created_at
    }
  }

  private taskParams(workflowId: string, t: Task): Record<string, unknown> {
    return {
      workflowId,
      id: t.id,
      title: t.title,
      prompt: t.prompt,
      dependsOn: JSON.stringify(t.dependsOn),
      status: t.status,
      agentId: t.agentId,
      retryCount: t.retryCount,
      conflict: t.conflict ? JSON.stringify(t.conflict) : null,
      createdAt: t.createdAt,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt,
      failureReason: t.failureReason
    }
  }
}
