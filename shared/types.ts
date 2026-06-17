import { z } from 'zod'

/**
 * Shared types + zod schemas that cross the IPC boundary.
 *
 * Every value flowing main <-> preload <-> renderer is validated against a
 * schema here. Main, preload, and renderer always agree on the wire format
 * because they all import from this file.
 */

// ---------------------------------------------------------------------------
// Errors (shared so main can throw them and the renderer can classify them)
// ---------------------------------------------------------------------------

export const MAESTRO_ERROR_CODES = [
  'GIT_ERROR',
  'NOT_A_GIT_REPO',
  'WORKTREE_CONFLICT',
  'WORKSPACE_NOT_FOUND',
  'REPO_NOT_FOUND',
  'WORKSPACE_DIRTY',
  'HARNESS_NOT_CONFIGURED',
  'HARNESS_UNAVAILABLE',
  'INTERNAL'
] as const
export const MaestroErrorCodeSchema = z.enum(MAESTRO_ERROR_CODES)
export type MaestroErrorCode = z.infer<typeof MaestroErrorCodeSchema>

/** Serializable error shape sent to the renderer for any failed IPC call. */
export const ErrorPayloadSchema = z.object({
  code: MaestroErrorCodeSchema,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional()
})
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>

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
// Use the INPUT type so callers may omit `agentType` (the schema default fills
// it in at parse time). Internally createWorkspace parses to the resolved shape.
export type CreateWorkspaceInput = z.input<typeof CreateWorkspaceInputSchema>

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

/** Full base-vs-worktree content for ONE file, for a side-by-side diff editor. */
export const FileDiffSchema = z.object({
  path: z.string(),
  /** Content at the merge-base (empty for added/untracked files). */
  original: z.string(),
  /** Current content in the worktree (empty for deleted files). */
  modified: z.string(),
  /** True if the file looks binary or is too large to diff as text. */
  binary: z.boolean()
})
export type FileDiff = z.infer<typeof FileDiffSchema>

export const FileDiffInputSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  /** For renames/copies: the file's path at the base. */
  oldPath: z.string().optional()
})
export type FileDiffInput = z.infer<typeof FileDiffInputSchema>

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

// ---------------------------------------------------------------------------
// Module 2 — agent events (the normalized harness output)
// ---------------------------------------------------------------------------

export const TokenUsageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
  cacheCreationTokens: z.number().optional(),
  totalCostUsd: z.number().optional(),
  model: z.string().optional()
})
export type TokenUsage = z.infer<typeof TokenUsageSchema>

/**
 * The normalized event stream every Harness emits, regardless of agent CLI.
 * The rest of the app depends only on this union — never on a CLI's raw JSON.
 * Validated with zod before crossing the IPC boundary to the renderer.
 */
export const AgentEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session_started'), sessionId: z.string() }),
  z.object({ kind: z.literal('assistant_text'), text: z.string() }),
  z.object({ kind: z.literal('tool_use'), name: z.string(), input: z.unknown() }),
  z.object({
    kind: z.literal('tool_result'),
    name: z.string(),
    ok: z.boolean(),
    summary: z.string().optional()
  }),
  z.object({
    kind: z.literal('turn_complete'),
    sessionId: z.string(),
    usage: TokenUsageSchema.optional()
  }),
  z.object({ kind: z.literal('error'), message: z.string() })
])
export type AgentEvent = z.infer<typeof AgentEventSchema>

// ---------------------------------------------------------------------------
// Module 3 — supervisor: push events (main -> renderer) + IPC request payloads
// ---------------------------------------------------------------------------

/**
 * Events the supervisor pushes to the renderer (via webContents.send). Carries
 * either a normalized agent event or a workspace status change, always tagged
 * with the workspace it belongs to so concurrent runs never get confused.
 */
export const WorkspacePushEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('agent_event'),
    workspaceId: z.string(),
    event: AgentEventSchema
  }),
  z.object({
    type: z.literal('status_changed'),
    workspaceId: z.string(),
    status: WorkspaceStatusSchema
  })
])
export type WorkspacePushEvent = z.infer<typeof WorkspacePushEventSchema>

export const RegisterRepoInputSchema = z.object({ repoPath: z.string().min(1) })
export type RegisterRepoInput = z.infer<typeof RegisterRepoInputSchema>

export const SetFilesToCopyInputSchema = z.object({
  repoPath: z.string().min(1),
  patterns: z.array(z.string())
})
export type SetFilesToCopyInput = z.infer<typeof SetFilesToCopyInputSchema>

export const StartAgentInputSchema = z.object({
  workspaceId: z.string().min(1),
  prompt: z.string().min(1),
  model: z.string().optional()
})
export type StartAgentInput = z.infer<typeof StartAgentInputSchema>

export const WorkspaceIdInputSchema = z.object({ id: z.string().min(1) })
export type WorkspaceIdInput = z.infer<typeof WorkspaceIdInputSchema>

export const ArchiveWorkspaceInputSchema = z.object({
  id: z.string().min(1),
  force: z.boolean().optional()
})
export type ArchiveWorkspaceInput = z.infer<typeof ArchiveWorkspaceInputSchema>

export const RepoPathInputSchema = z.object({ repoPath: z.string().min(1) })
export type RepoPathInput = z.infer<typeof RepoPathInputSchema>

export const AgentAvailabilityInputSchema = z.object({ agentType: AgentTypeSchema })
export type AgentAvailabilityInput = z.infer<typeof AgentAvailabilityInputSchema>
