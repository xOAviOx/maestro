import { randomUUID } from 'crypto'
import type { Db } from './Database'
import type { ReviewEvent, ReviewEventKind } from '@shared/types'

interface ReviewEventRow {
  id: string
  workspace_id: string
  repo_path: string
  kind: string
  base_branch: string
  branch: string
  url: string | null
  committed: number
  created_at: string
}

function rowToEvent(row: ReviewEventRow): ReviewEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    repoPath: row.repo_path,
    kind: row.kind as ReviewEventKind,
    baseBranch: row.base_branch,
    branch: row.branch,
    url: row.url,
    committed: row.committed !== 0,
    createdAt: row.created_at
  }
}

/** What a caller supplies to record an event; id + timestamp are filled in here. */
export interface NewReviewEvent {
  workspaceId: string
  repoPath: string
  kind: ReviewEventKind
  baseBranch: string
  branch: string
  url?: string | null
  committed: boolean
}

/** Append-only persistence for review outcomes (merges + PRs). */
export class ReviewEventStore {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  /** Append an event and return the stored record. */
  record(event: NewReviewEvent): ReviewEvent {
    const stored: ReviewEvent = {
      id: randomUUID(),
      workspaceId: event.workspaceId,
      repoPath: event.repoPath,
      kind: event.kind,
      baseBranch: event.baseBranch,
      branch: event.branch,
      url: event.url ?? null,
      committed: event.committed,
      createdAt: new Date().toISOString()
    }
    this.db
      .prepare(
        `INSERT INTO review_events
           (id, workspace_id, repo_path, kind, base_branch, branch, url, committed, created_at)
         VALUES
           (@id, @workspaceId, @repoPath, @kind, @baseBranch, @branch, @url, @committed, @createdAt)`
      )
      .run({ ...stored, committed: stored.committed ? 1 : 0 })
    return stored
  }

  /**
   * All events for a workspace, newest first. `rowid` (monotonic insertion
   * order) is the tiebreaker so events recorded within the same millisecond —
   * e.g. a merge immediately followed by a PR — still order deterministically.
   */
  listByWorkspace(workspaceId: string): ReviewEvent[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM review_events WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC'
      )
      .all(workspaceId) as ReviewEventRow[]
    return rows.map(rowToEvent)
  }
}
