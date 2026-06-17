import type { Db } from './Database'
import type { AgentType, Workspace, WorkspaceStatus } from '@shared/types'

interface WorkspaceRow {
  id: string
  repo_path: string
  repo_name: string
  name: string
  branch: string
  base_branch: string
  worktree_path: string
  agent_type: string
  session_id: string | null
  status: string
  created_at: string
  archived_at: string | null
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    repoPath: row.repo_path,
    repoName: row.repo_name,
    name: row.name,
    branch: row.branch,
    baseBranch: row.base_branch,
    worktreePath: row.worktree_path,
    agentType: row.agent_type as AgentType,
    sessionId: row.session_id,
    status: row.status as WorkspaceStatus,
    createdAt: row.created_at,
    archivedAt: row.archived_at
  }
}

/** Persistence for workspaces. */
export class WorkspaceStore {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  insert(ws: Workspace): void {
    this.db
      .prepare(
        `INSERT INTO workspaces
           (id, repo_path, repo_name, name, branch, base_branch, worktree_path,
            agent_type, session_id, status, created_at, archived_at)
         VALUES
           (@id, @repoPath, @repoName, @name, @branch, @baseBranch, @worktreePath,
            @agentType, @sessionId, @status, @createdAt, @archivedAt)`
      )
      .run(ws)
  }

  getById(id: string): Workspace | undefined {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as
      | WorkspaceRow
      | undefined
    return row ? rowToWorkspace(row) : undefined
  }

  listByRepo(repoPath: string, includeArchived = false): Workspace[] {
    const sql = includeArchived
      ? 'SELECT * FROM workspaces WHERE repo_path = ? ORDER BY created_at DESC'
      : 'SELECT * FROM workspaces WHERE repo_path = ? AND archived_at IS NULL ORDER BY created_at DESC'
    const rows = this.db.prepare(sql).all(repoPath) as WorkspaceRow[]
    return rows.map(rowToWorkspace)
  }

  listAll(includeArchived = false): Workspace[] {
    const sql = includeArchived
      ? 'SELECT * FROM workspaces ORDER BY created_at DESC'
      : 'SELECT * FROM workspaces WHERE archived_at IS NULL ORDER BY created_at DESC'
    const rows = this.db.prepare(sql).all() as WorkspaceRow[]
    return rows.map(rowToWorkspace)
  }

  /** Active (non-archived) workspace using a given branch in a repo, if any. */
  findActiveByRepoAndBranch(repoPath: string, branch: string): Workspace | undefined {
    const row = this.db
      .prepare(
        'SELECT * FROM workspaces WHERE repo_path = ? AND branch = ? AND archived_at IS NULL'
      )
      .get(repoPath, branch) as WorkspaceRow | undefined
    return row ? rowToWorkspace(row) : undefined
  }

  setStatus(id: string, status: WorkspaceStatus): void {
    this.db.prepare('UPDATE workspaces SET status = ? WHERE id = ?').run(status, id)
  }

  setSessionId(id: string, sessionId: string | null): void {
    this.db.prepare('UPDATE workspaces SET session_id = ? WHERE id = ?').run(sessionId, id)
  }

  markArchived(id: string, archivedAt: string = new Date().toISOString()): void {
    this.db.prepare('UPDATE workspaces SET archived_at = ? WHERE id = ?').run(archivedAt, id)
  }
}
