import { z } from 'zod'

/**
 * Shared types + zod schemas that cross the IPC boundary.
 *
 * Every value flowing main <-> preload <-> renderer is validated against a
 * schema here. Main, preload, and renderer always agree on the wire format
 * because they all import from this file.
 */

// ---------------------------------------------------------------------------
// Module 0 — connectivity smoke test (ping/pong)
// ---------------------------------------------------------------------------

export const PingRequestSchema = z.object({
  message: z.string()
})
export type PingRequest = z.infer<typeof PingRequestSchema>

export const PingResponseSchema = z.object({
  reply: z.string(),
  /** ISO-8601 timestamp produced by the main process. */
  at: z.string(),
  /** Electron + Chrome + Node versions, proving we crossed into main. */
  versions: z.object({
    electron: z.string(),
    chrome: z.string(),
    node: z.string()
  })
})
export type PingResponse = z.infer<typeof PingResponseSchema>

// ---------------------------------------------------------------------------
// Module 1 — workspaces, repos, diffs
// ---------------------------------------------------------------------------

/** Supported agent CLIs. Only 'claude-code' is fully implemented (the rest are
 * stubs). The app never branches on this beyond the harness factory. */
export const AGENT_TYPES = ['claude-code', 'codex', 'cursor'] as const
export const AgentTypeSchema = z.enum(AGENT_TYPES)
export type AgentType = z.infer<typeof AgentTypeSchema>

export const WORKSPACE_STATUSES = [
  'idle', // created, no agent running
  'running', // agent actively working
  'awaiting_input', // agent finished a turn, waiting for the user
  'done', // task reported complete this session
  'error' // agent or git op failed
] as const
export const WorkspaceStatusSchema = z.enum(WORKSPACE_STATUSES)
export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>

export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  /** Absolute path to the source repo root. */
  repoPath: z.string(),
  repoName: z.string(),
  /** User-facing workspace name. */
  name: z.string(),
  /** Branch checked out in this worktree (unique per repo). */
  branch: z.string(),
  /** Branch this was created from (diff/merge target). */
  baseBranch: z.string(),
  /** Absolute path to the isolated worktree on disk. */
  worktreePath: z.string(),
  agentType: AgentTypeSchema,
  /** Agent session id, for resume. Null until the first turn completes. */
  sessionId: z.string().nullable(),
  status: WorkspaceStatusSchema,
  createdAt: z.string(),
  archivedAt: z.string().nullable()
})
export type Workspace = z.infer<typeof WorkspaceSchema>

/** A repo the user has opened, as persisted. `branches` is fetched live from
 * git (see RepoInfo) rather than stored. */
export const RepoRecordSchema = z.object({
  path: z.string(),
  name: z.string(),
  defaultBaseBranch: z.string(),
  /** Glob patterns for gitignored files to copy into each new worktree
   * (e.g. ".env.local") so agents' dev servers can boot. */
  filesToCopy: z.array(z.string()),
  addedAt: z.string()
})
export type RepoRecord = z.infer<typeof RepoRecordSchema>

/** A repo record plus live git data (branches, current branch). */
export const RepoInfoSchema = RepoRecordSchema.extend({
  branches: z.array(z.string()),
  currentBranch: z.string().nullable()
})
export type RepoInfo = z.infer<typeof RepoInfoSchema>

export const CreateWorkspaceInputSchema = z.object({
  repoPath: z.string().min(1),
  name: z.string().min(1),
  /** Defaults to the repo's detected default base branch when omitted. */
  baseBranch: z.string().optional(),
  agentType: AgentTypeSchema.default('claude-code')
})
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceInputSchema>

export const DIFF_FILE_STATUSES = [
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'type-changed',
  'untracked'
] as const
export const DiffFileStatusSchema = z.enum(DIFF_FILE_STATUSES)
export type DiffFileStatus = z.infer<typeof DiffFileStatusSchema>

export const DiffFileSchema = z.object({
  path: z.string(),
  status: DiffFileStatusSchema,
  /** Present for renames/copies. */
  oldPath: z.string().optional()
})
export type DiffFile = z.infer<typeof DiffFileSchema>

export const WorkspaceDiffSchema = z.object({
  baseBranch: z.string(),
  /** The merge-base commit the diff is computed against. */
  mergeBase: z.string(),
  files: z.array(DiffFileSchema),
  /** Unified diff text for tracked changes (committed + uncommitted). */
  patch: z.string(),
  /** Untracked files present in the worktree (not in the patch). */
  untracked: z.array(z.string())
})
export type WorkspaceDiff = z.infer<typeof WorkspaceDiffSchema>
