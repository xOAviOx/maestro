import { openDatabase, type Db } from './store/Database'
import { RepoStore } from './store/RepoStore'
import { WorkspaceStore } from './store/WorkspaceStore'
import { GitService } from './GitService'
import { WorktreeManager } from './WorktreeManager'

/**
 * The engine: git + persistence + worktree orchestration, wired together.
 * Constructed once in the main process (and in test scripts) and shared.
 */
export interface Engine {
  db: Db
  git: GitService
  repos: RepoStore
  workspaces: WorkspaceStore
  worktrees: WorktreeManager
  close(): void
}

export function createEngine(dbPath?: string): Engine {
  const db = openDatabase(dbPath)
  const git = new GitService()
  const repos = new RepoStore(db)
  const workspaces = new WorkspaceStore(db)
  const worktrees = new WorktreeManager(git, repos, workspaces)
  return {
    db,
    git,
    repos,
    workspaces,
    worktrees,
    close: () => db.close()
  }
}

export { GitService } from './GitService'
export { WorktreeManager } from './WorktreeManager'
export { RepoStore } from './store/RepoStore'
export { WorkspaceStore } from './store/WorkspaceStore'
export { openDatabase } from './store/Database'
