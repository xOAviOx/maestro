import { randomUUID } from 'crypto'
import type { Db } from './Database'
import type { UsageEvent } from '@shared/types'

interface UsageEventRow {
  id: string
  workspace_id: string
  task_id: string | null
  workflow_id: string | null
  model: string | null
  input_tokens: number
  output_tokens: number
  cache_creation_tokens: number
  cache_read_tokens: number
  cli_cost_usd: number | null
  created_at: string
}

function rowToEvent(row: UsageEventRow): UsageEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    taskId: row.task_id,
    workflowId: row.workflow_id,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheCreationTokens: row.cache_creation_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cliCostUsd: row.cli_cost_usd,
    createdAt: row.created_at
  }
}

/** What a caller supplies to record a usage sample; id + timestamp are filled in here. */
export interface NewUsageEvent {
  workspaceId: string
  taskId?: string | null
  workflowId?: string | null
  model?: string | null
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  cliCostUsd?: number | null
}

/** Append-only persistence for per-turn token/cost usage samples. */
export class UsageEventStore {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  /** Append a usage sample and return the stored record. */
  record(event: NewUsageEvent): UsageEvent {
    const stored: UsageEvent = {
      id: randomUUID(),
      workspaceId: event.workspaceId,
      taskId: event.taskId ?? null,
      workflowId: event.workflowId ?? null,
      model: event.model ?? null,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cacheCreationTokens: event.cacheCreationTokens,
      cacheReadTokens: event.cacheReadTokens,
      cliCostUsd: event.cliCostUsd ?? null,
      createdAt: new Date().toISOString()
    }
    this.db
      .prepare(
        `INSERT INTO usage_events
           (id, workspace_id, task_id, workflow_id, model,
            input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
            cli_cost_usd, created_at)
         VALUES
           (@id, @workspaceId, @taskId, @workflowId, @model,
            @inputTokens, @outputTokens, @cacheCreationTokens, @cacheReadTokens,
            @cliCostUsd, @createdAt)`
      )
      .run(stored)
    return stored
  }

  /** All usage samples for a workspace, newest first (rowid breaks same-ms ties). */
  listByWorkspace(workspaceId: string): UsageEvent[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM usage_events WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC'
      )
      .all(workspaceId) as UsageEventRow[]
    return rows.map(rowToEvent)
  }

  /** All usage samples, newest first, optionally capped to the most recent `limit`. */
  listAll(limit?: number): UsageEvent[] {
    const rows =
      limit === undefined
        ? (this.db
            .prepare('SELECT * FROM usage_events ORDER BY created_at DESC, rowid DESC')
            .all() as UsageEventRow[])
        : (this.db
            .prepare('SELECT * FROM usage_events ORDER BY created_at DESC, rowid DESC LIMIT ?')
            .all(limit) as UsageEventRow[])
    return rows.map(rowToEvent)
  }
}
