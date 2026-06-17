import { openDatabase, type Db } from './store/Database'
import { RepoStore } from './store/RepoStore'
import { WorkspaceStore } from './store/WorkspaceStore'
import { CredentialStore, type SecretCipher } from './store/CredentialStore'
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
  credentials: CredentialStore
  close(): void
}

/**
 * A cipher that reports itself unavailable — the default when no secure storage
 * is wired in (e.g. headless smoke tests). Credential set() then refuses rather
 * than persisting plaintext.
 */
const NULL_CIPHER: SecretCipher = {
  isAvailable: () => false,
  encrypt: () => {
    throw new Error('Secure storage unavailable')
  },
  decrypt: () => {
    throw new Error('Secure storage unavailable')
  }
}

export interface EngineOptions {
  dbPath?: string
  /** Secure storage for credentials; defaults to an unavailable cipher. */
  cipher?: SecretCipher
}

export function createEngine(options: EngineOptions | string = {}): Engine {
  // Back-compat: createEngine(dbPath) still works.
  const opts: EngineOptions = typeof options === 'string' ? { dbPath: options } : options
  const db = openDatabase(opts.dbPath)
  const git = new GitService()
  const repos = new RepoStore(db)
  const workspaces = new WorkspaceStore(db)
  const worktrees = new WorktreeManager(git, repos, workspaces)
  const credentials = new CredentialStore(db, opts.cipher ?? NULL_CIPHER)
  return {
    db,
    git,
    repos,
    workspaces,
    worktrees,
    credentials,
    close: () => db.close()
  }
}

export { GitService } from './GitService'
export { WorktreeManager } from './WorktreeManager'
export { RepoStore } from './store/RepoStore'
export { WorkspaceStore } from './store/WorkspaceStore'
export { CredentialStore } from './store/CredentialStore'
export type { SecretCipher } from './store/CredentialStore'
export { openDatabase } from './store/Database'
