/**
 * Typed errors for the engine.
 *
 * Every git op and agent run can fail. Failures are normalized to one of these
 * so the IPC layer can serialize them to the renderer as `{ code, message }`
 * without leaking stack traces or crashing the main process.
 */
export type MaestroErrorCode =
  | 'GIT_ERROR'
  | 'NOT_A_GIT_REPO'
  | 'WORKTREE_CONFLICT'
  | 'WORKSPACE_NOT_FOUND'
  | 'REPO_NOT_FOUND'
  | 'WORKSPACE_DIRTY'
  | 'HARNESS_NOT_CONFIGURED'
  | 'HARNESS_UNAVAILABLE'
  | 'INTERNAL'

export class MaestroError extends Error {
  readonly code: MaestroErrorCode
  readonly details: Record<string, unknown> | undefined

  constructor(code: MaestroErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'MaestroError'
    this.code = code
    this.details = details
  }
}

export class GitError extends MaestroError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('GIT_ERROR', message, details)
    this.name = 'GitError'
  }
}

export class NotAGitRepoError extends MaestroError {
  constructor(path: string) {
    super('NOT_A_GIT_REPO', `Not a git repository: ${path}`, { path })
    this.name = 'NotAGitRepoError'
  }
}

export class WorktreeConflictError extends MaestroError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('WORKTREE_CONFLICT', message, details)
    this.name = 'WorktreeConflictError'
  }
}

export class WorkspaceNotFoundError extends MaestroError {
  constructor(id: string) {
    super('WORKSPACE_NOT_FOUND', `Workspace not found: ${id}`, { id })
    this.name = 'WorkspaceNotFoundError'
  }
}

export class RepoNotFoundError extends MaestroError {
  constructor(path: string) {
    super('REPO_NOT_FOUND', `Repo not registered: ${path}`, { path })
    this.name = 'RepoNotFoundError'
  }
}

export class WorkspaceDirtyError extends MaestroError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('WORKSPACE_DIRTY', message, details)
    this.name = 'WorkspaceDirtyError'
  }
}

/** Serializable shape sent to the renderer for any failed IPC call. */
export interface ErrorPayload {
  code: MaestroErrorCode
  message: string
  details?: Record<string, unknown>
}

/** Normalize any thrown value into a MaestroError. */
export function toMaestroError(err: unknown): MaestroError {
  if (err instanceof MaestroError) return err
  if (err instanceof Error) return new MaestroError('INTERNAL', err.message)
  return new MaestroError('INTERNAL', String(err))
}

/** Convert any thrown value into a serializable ErrorPayload for IPC. */
export function toErrorPayload(err: unknown): ErrorPayload {
  const e = toMaestroError(err)
  return e.details !== undefined
    ? { code: e.code, message: e.message, details: e.details }
    : { code: e.code, message: e.message }
}
