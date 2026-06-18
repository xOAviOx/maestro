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
  'MERGE_CONFLICT',
  'NOTHING_TO_MERGE',
  'GH_UNAVAILABLE',
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
  /** Fan-out group id: set when this workspace is one variant of a fan-out
   * task (sibling variants share it). Null for standalone workspaces. */
  groupId: z.string().nullable(),
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

/**
 * Fan-out: launch one task as N competing variants, each in its own worktree.
 * Variants differ by agent + (optional) model, so you can race e.g. two Claude
 * models, or Claude vs Codex, on the same prompt and keep the winner. The
 * variants array is bounded (2–5) to keep concurrent agent load sane.
 */
export const FanOutVariantSchema = z.object({
  agentType: AgentTypeSchema,
  /** Optional per-variant model override passed to that variant's agent. */
  model: z.string().optional()
})
export type FanOutVariant = z.infer<typeof FanOutVariantSchema>

export const FanOutInputSchema = z.object({
  repoPath: z.string().min(1),
  name: z.string().min(1),
  /** Defaults to the repo's detected default base branch when omitted. */
  baseBranch: z.string().optional(),
  /** The shared task sent to every variant's first turn. */
  prompt: z.string().min(1),
  variants: z.array(FanOutVariantSchema).min(2).max(5)
})
export type FanOutInput = z.infer<typeof FanOutInputSchema>

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
 * A queued agent turn. The supervisor runs jobs FIFO; a job becomes runnable
 * when its workspace is free AND its dependency (if any) has finished. This one
 * shape covers both queue modes:
 *   - sequential : several jobs on the SAME workspace run one at a time.
 *   - chaining   : `dependsOnWorkspaceId` makes a job wait for another
 *                  workspace to finish (pipeline across worktrees/agents).
 * The pending queue is in-memory for the session (not yet persisted).
 */
export const QueuedJobSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  prompt: z.string(),
  model: z.string().optional(),
  /** When set, this job waits until that workspace finishes its run. */
  dependsOnWorkspaceId: z.string().nullable(),
  createdAt: z.string()
})
export type QueuedJob = z.infer<typeof QueuedJobSchema>

/**
 * Events the supervisor pushes to the renderer (via webContents.send). Carries
 * either a normalized agent event or a workspace status change, always tagged
 * with the workspace it belongs to so concurrent runs never get confused.
 * `queue_changed` carries the full pending-job list (renderer filters by
 * workspace) so the UI always reflects the live queue.
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
  }),
  z.object({
    type: z.literal('queue_changed'),
    jobs: z.array(QueuedJobSchema)
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

/**
 * Login state for one agent CLI, shown in the Accounts settings panel.
 * `installed`: the CLI binary was found on PATH.
 * `loggedIn`: the CLI reports an authenticated account (e.g. Claude Pro/Max via
 *   `claude auth status`, Codex via `codex login status`). We only detect this —
 *   credentials stay owned by the CLI; Maestro never reads or stores tokens.
 */
export const AgentAuthStatusSchema = z.object({
  agentType: AgentTypeSchema,
  installed: z.boolean(),
  loggedIn: z.boolean()
})
export type AgentAuthStatus = z.infer<typeof AgentAuthStatusSchema>

/** Start an agent CLI login flow in a pty of the given size. */
export const AgentLoginInputSchema = z.object({
  agentType: AgentTypeSchema,
  cols: z.number().int().positive(),
  rows: z.number().int().positive()
})
export type AgentLoginInput = z.infer<typeof AgentLoginInputSchema>

/** Result of starting a login pty: the key terminal events are tagged with. */
export const AgentLoginStartResultSchema = z
  .object({ sessionKey: z.string().min(1) })
  .nullable()
export type AgentLoginStartResult = z.infer<typeof AgentLoginStartResultSchema>

/**
 * Headless/CI credential fallback. Most users sign in via the agent CLI's own
 * login; this is an opt-in "Advanced" path for machines that can't run an
 * interactive OAuth flow. `kind` selects which env var the secret is injected
 * as at spawn time (see CREDENTIAL_ENV_VARS in main). The secret value itself
 * is write-only: it's stored encrypted and never read back to the renderer.
 */
export const CREDENTIAL_KINDS = ['oauth-token', 'api-key'] as const
export const CredentialKindSchema = z.enum(CREDENTIAL_KINDS)
export type CredentialKind = z.infer<typeof CredentialKindSchema>

export const SetCredentialInputSchema = z.object({
  agentType: AgentTypeSchema,
  kind: CredentialKindSchema,
  secret: z.string().min(1)
})
export type SetCredentialInput = z.infer<typeof SetCredentialInputSchema>

/** Non-secret view of a stored credential, safe to send to the renderer. */
export const CredentialInfoSchema = z.object({
  agentType: AgentTypeSchema,
  configured: z.boolean(),
  kind: CredentialKindSchema.nullable(),
  updatedAt: z.string().nullable()
})
export type CredentialInfo = z.infer<typeof CredentialInfoSchema>

// ---------------------------------------------------------------------------
// Module 6 — merge & review
// ---------------------------------------------------------------------------

/** Live review status for a workspace, shown in the ReviewBar. */
export const ReviewStatusSchema = z.object({
  /** Uncommitted (staged/unstaged) changes present in the worktree. */
  hasUncommittedChanges: z.boolean(),
  /** Number of changed files vs the base branch (committed + uncommitted). */
  changedFileCount: z.number(),
  /** True if base branch is checked out in a worktree (required for merge). */
  baseCheckedOut: z.boolean(),
  baseBranch: z.string()
})
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>

export const MergeResultSchema = z.object({
  merged: z.boolean(),
  /** Commit created in the worktree before merging, if changes were committed. */
  committed: z.boolean(),
  baseBranch: z.string(),
  branch: z.string()
})
export type MergeResult = z.infer<typeof MergeResultSchema>

export const PullRequestResultSchema = z.object({
  url: z.string(),
  committed: z.boolean()
})
export type PullRequestResult = z.infer<typeof PullRequestResultSchema>

export const CommitWorkspaceInputSchema = z.object({
  id: z.string().min(1),
  message: z.string().min(1)
})
export type CommitWorkspaceInput = z.infer<typeof CommitWorkspaceInputSchema>

export const MergeWorkspaceInputSchema = z.object({
  id: z.string().min(1),
  /** Commit message for any uncommitted changes (defaults applied if omitted). */
  commitMessage: z.string().optional(),
  /** Archive (remove worktree) after a successful merge. */
  archiveAfter: z.boolean().optional()
})
export type MergeWorkspaceInput = z.infer<typeof MergeWorkspaceInputSchema>

export const CreatePrInputSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  body: z.string().optional(),
  commitMessage: z.string().optional()
})
export type CreatePrInput = z.infer<typeof CreatePrInputSchema>

// ---------------------------------------------------------------------------
// Module 4b — raw terminal per workspace (node-pty + xterm)
// ---------------------------------------------------------------------------

export const TerminalStartInputSchema = z.object({
  workspaceId: z.string().min(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive()
})
export type TerminalStartInput = z.infer<typeof TerminalStartInputSchema>

export const TerminalStartResultSchema = z.object({
  /** Recent output replayed when re-attaching to an existing session. */
  buffer: z.string()
})
export type TerminalStartResult = z.infer<typeof TerminalStartResultSchema>

export const TerminalInputSchema = z.object({
  workspaceId: z.string().min(1),
  data: z.string()
})
export type TerminalInputMessage = z.infer<typeof TerminalInputSchema>

export const TerminalResizeSchema = z.object({
  workspaceId: z.string().min(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive()
})
export type TerminalResizeMessage = z.infer<typeof TerminalResizeSchema>

export const TerminalDataEventSchema = z.object({
  workspaceId: z.string(),
  data: z.string()
})
export type TerminalDataEvent = z.infer<typeof TerminalDataEventSchema>

export const TerminalExitEventSchema = z.object({
  workspaceId: z.string(),
  exitCode: z.number()
})
export type TerminalExitEvent = z.infer<typeof TerminalExitEventSchema>
