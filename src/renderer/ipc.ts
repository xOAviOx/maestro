import { z } from 'zod'
import {
  AgentAuthStatusSchema,
  AgentLoginStartResultSchema,
  CredentialInfoSchema,
  ErrorPayloadSchema,
  FileDiffSchema,
  MergeResultSchema,
  PingResponseSchema,
  PullRequestResultSchema,
  QueuedJobSchema,
  RepoInfoSchema,
  RepoRecordSchema,
  ReviewEventSchema,
  ReviewStatusSchema,
  TerminalDataEventSchema,
  TerminalExitEventSchema,
  TerminalStartResultSchema,
  TestResultSchema,
  UsageEventSchema,
  UsageSummarySchema,
  WorkflowPushEventSchema,
  WorkflowSchema,
  WorkspaceDiffSchema,
  WorkspacePushEventSchema,
  WorkspaceSchema,
  type AgentType,
  type AgentAuthStatus,
  type AgentLoginStartResult,
  type CredentialInfo,
  type CredentialKind,
  type CreateWorkflowInput,
  type CreateWorkspaceInput,
  type EnqueueJobInput,
  type FanOutInput,
  type FileDiff,
  type MaestroErrorCode,
  type MergeResult,
  type PingResponse,
  type PullRequestResult,
  type QueuedJob,
  type RepoInfo,
  type RepoRecord,
  type ReviewEvent,
  type ReviewStatus,
  type TerminalDataEvent,
  type TerminalExitEvent,
  type TerminalStartResult,
  type TestResult,
  type UsageEvent,
  type UsageListInput,
  type UsageSummary,
  type Workflow,
  type WorkflowPushEvent,
  type Workspace,
  type WorkspaceDiff,
  type WorkspacePushEvent
} from '@shared/types'

/**
 * Typed client wrapper around `window.maestro`.
 *
 *  - Validates every response with its zod schema, so the renderer only trusts
 *    well-formed data crossing the IPC boundary.
 *  - Parses main's serialized error payload back into a structured
 *    MaestroClientError with a readable message + code for the UI.
 *
 * The renderer never imports `window.maestro` directly outside this file.
 */
export class MaestroClientError extends Error {
  readonly code: MaestroErrorCode | 'UNKNOWN'
  readonly details: Record<string, unknown> | undefined
  constructor(code: MaestroErrorCode | 'UNKNOWN', message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'MaestroClientError'
    this.code = code
    this.details = details
  }
}

function parseError(err: unknown): MaestroClientError {
  if (err instanceof Error) {
    try {
      const parsed = ErrorPayloadSchema.parse(JSON.parse(err.message))
      return new MaestroClientError(parsed.code, parsed.message, parsed.details)
    } catch {
      return new MaestroClientError('UNKNOWN', err.message)
    }
  }
  return new MaestroClientError('UNKNOWN', String(err))
}

async function call<T>(promise: Promise<unknown>, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await promise
  } catch (err) {
    throw parseError(err)
  }
  return schema.parse(raw)
}

async function callVoid(promise: Promise<unknown>): Promise<void> {
  try {
    await promise
  } catch (err) {
    throw parseError(err)
  }
}

export const ipc = {
  ping: (message: string): Promise<PingResponse> =>
    call(window.maestro.ping(message), PingResponseSchema),

  openDirectoryDialog: (): Promise<string | null> =>
    call(window.maestro.openDirectoryDialog(), z.string().nullable()),

  openExternal: (url: string): Promise<void> => callVoid(window.maestro.openExternal(url)),

  // repos
  registerRepo: (repoPath: string): Promise<RepoInfo> =>
    call(window.maestro.registerRepo(repoPath), RepoInfoSchema),
  listRepos: (): Promise<RepoRecord[]> =>
    call(window.maestro.listRepos(), z.array(RepoRecordSchema)),
  getRepoInfo: (repoPath: string): Promise<RepoInfo> =>
    call(window.maestro.getRepoInfo(repoPath), RepoInfoSchema),
  setFilesToCopy: (repoPath: string, patterns: string[]): Promise<void> =>
    callVoid(window.maestro.setFilesToCopy(repoPath, patterns)),
  setTestCommand: (repoPath: string, testCommand: string): Promise<void> =>
    callVoid(window.maestro.setTestCommand(repoPath, testCommand)),

  // workspaces
  createWorkspace: (input: CreateWorkspaceInput): Promise<Workspace> =>
    call(window.maestro.createWorkspace(input), WorkspaceSchema),
  fanOut: (input: FanOutInput): Promise<Workspace[]> =>
    call(window.maestro.fanOut(input), z.array(WorkspaceSchema)),
  listWorkspaces: (repoPath: string): Promise<Workspace[]> =>
    call(window.maestro.listWorkspaces(repoPath), z.array(WorkspaceSchema)),
  listAllWorkspaces: (): Promise<Workspace[]> =>
    call(window.maestro.listAllWorkspaces(), z.array(WorkspaceSchema)),
  getWorkspace: (id: string): Promise<Workspace> =>
    call(window.maestro.getWorkspace(id), WorkspaceSchema),
  getDiff: (id: string): Promise<WorkspaceDiff> =>
    call(window.maestro.getDiff(id), WorkspaceDiffSchema),
  getFileDiff: (id: string, path: string, oldPath?: string): Promise<FileDiff> =>
    call(window.maestro.getFileDiff(id, path, oldPath), FileDiffSchema),
  getReviewStatus: (id: string): Promise<ReviewStatus> =>
    call(window.maestro.getReviewStatus(id), ReviewStatusSchema),
  listReviewHistory: (id: string): Promise<ReviewEvent[]> =>
    call(window.maestro.listReviewHistory(id), z.array(ReviewEventSchema)),
  commitWorkspace: (id: string, message: string): Promise<boolean> =>
    call(window.maestro.commitWorkspace(id, message), z.boolean()),
  mergeWorkspace: (
    id: string,
    options?: { commitMessage?: string; archiveAfter?: boolean }
  ): Promise<MergeResult> => call(window.maestro.mergeWorkspace(id, options), MergeResultSchema),
  createPullRequest: (
    id: string,
    options?: { title?: string; body?: string; commitMessage?: string }
  ): Promise<PullRequestResult> =>
    call(window.maestro.createPullRequest(id, options), PullRequestResultSchema),
  archiveWorkspace: (id: string, force?: boolean): Promise<void> =>
    callVoid(window.maestro.archiveWorkspace(id, force)),
  archiveSiblings: (id: string): Promise<void> =>
    callVoid(window.maestro.archiveSiblings(id)),
  runTests: (id: string): Promise<TestResult> =>
    call(window.maestro.runTests(id), TestResultSchema),

  // agents
  startAgent: (workspaceId: string, prompt: string, model?: string): Promise<void> =>
    callVoid(window.maestro.startAgent(workspaceId, prompt, model)),
  cancelAgent: (workspaceId: string): Promise<void> =>
    callVoid(window.maestro.cancelAgent(workspaceId)),
  enqueueJob: (input: EnqueueJobInput): Promise<QueuedJob> =>
    call(window.maestro.enqueueJob(input), QueuedJobSchema),
  listQueue: (): Promise<QueuedJob[]> =>
    call(window.maestro.listQueue(), z.array(QueuedJobSchema)),
  cancelJob: (jobId: string): Promise<void> => callVoid(window.maestro.cancelJob(jobId)),
  isAgentAvailable: (agentType: AgentType): Promise<boolean> =>
    call(window.maestro.isAgentAvailable(agentType), z.boolean()),
  getAgentAuthStatus: (agentType: AgentType): Promise<AgentAuthStatus> =>
    call(window.maestro.getAgentAuthStatus(agentType), AgentAuthStatusSchema),
  startAgentLogin: (
    agentType: AgentType,
    cols: number,
    rows: number
  ): Promise<AgentLoginStartResult> =>
    call(window.maestro.startAgentLogin(agentType, cols, rows), AgentLoginStartResultSchema),
  getCredentialInfo: (agentType: AgentType): Promise<CredentialInfo> =>
    call(window.maestro.getCredentialInfo(agentType), CredentialInfoSchema),
  setCredential: (
    agentType: AgentType,
    kind: CredentialKind,
    secret: string
  ): Promise<CredentialInfo> =>
    call(window.maestro.setCredential(agentType, kind, secret), CredentialInfoSchema),
  clearCredential: (agentType: AgentType): Promise<CredentialInfo> =>
    call(window.maestro.clearCredential(agentType), CredentialInfoSchema),
  isGhAvailable: (): Promise<boolean> => call(window.maestro.isGhAvailable(), z.boolean()),

  // workflows (DAG scheduler)
  createWorkflow: (input: CreateWorkflowInput): Promise<Workflow> =>
    call(window.maestro.createWorkflow(input), WorkflowSchema),
  listWorkflows: (): Promise<Workflow[]> =>
    call(window.maestro.listWorkflows(), z.array(WorkflowSchema)),
  getWorkflow: (id: string): Promise<Workflow> =>
    call(window.maestro.getWorkflow(id), WorkflowSchema),
  startWorkflow: (id: string): Promise<Workflow> =>
    call(window.maestro.startWorkflow(id), WorkflowSchema),
  pauseWorkflow: (id: string): Promise<Workflow> =>
    call(window.maestro.pauseWorkflow(id), WorkflowSchema),
  resumeWorkflow: (id: string): Promise<Workflow> =>
    call(window.maestro.resumeWorkflow(id), WorkflowSchema),
  approveTask: (workflowId: string, taskId: string): Promise<Workflow> =>
    call(window.maestro.approveTask(workflowId, taskId), WorkflowSchema),
  rejectTask: (
    workflowId: string,
    taskId: string,
    mode?: 'cascade' | 'retry',
    prompt?: string
  ): Promise<Workflow> =>
    call(window.maestro.rejectTask(workflowId, taskId, mode, prompt), WorkflowSchema),
  retryTask: (workflowId: string, taskId: string): Promise<Workflow> =>
    call(window.maestro.retryTask(workflowId, taskId), WorkflowSchema),
  previewCascade: (workflowId: string, taskId: string): Promise<string[]> =>
    call(window.maestro.previewCascade(workflowId, taskId), z.array(z.string())),
  onWorkflowEvent: (listener: (evt: WorkflowPushEvent) => void): (() => void) =>
    window.maestro.onWorkflowEvent((raw) => {
      const parsed = WorkflowPushEventSchema.safeParse(raw)
      if (parsed.success) listener(parsed.data)
    }),

  // usage & cost (collection pipeline)
  listUsage: (input?: UsageListInput): Promise<UsageEvent[]> =>
    call(window.maestro.listUsage(input), z.array(UsageEventSchema)),
  getUsageSummary: (workspaceId?: string): Promise<UsageSummary> =>
    call(window.maestro.getUsageSummary(workspaceId), UsageSummarySchema),

  // terminal
  startTerminal: (workspaceId: string, cols: number, rows: number): Promise<TerminalStartResult> =>
    call(window.maestro.startTerminal(workspaceId, cols, rows), TerminalStartResultSchema),
  sendTerminalInput: (workspaceId: string, data: string): void =>
    window.maestro.sendTerminalInput(workspaceId, data),
  resizeTerminal: (workspaceId: string, cols: number, rows: number): void =>
    window.maestro.resizeTerminal(workspaceId, cols, rows),
  disposeTerminal: (workspaceId: string): Promise<void> =>
    callVoid(window.maestro.disposeTerminal(workspaceId)),
  onTerminalData: (listener: (evt: TerminalDataEvent) => void): (() => void) =>
    window.maestro.onTerminalData((raw) => {
      const parsed = TerminalDataEventSchema.safeParse(raw)
      if (parsed.success) listener(parsed.data)
    }),
  onTerminalExit: (listener: (evt: TerminalExitEvent) => void): (() => void) =>
    window.maestro.onTerminalExit((raw) => {
      const parsed = TerminalExitEventSchema.safeParse(raw)
      if (parsed.success) listener(parsed.data)
    }),

  // push subscription — re-validate every event before app code sees it
  onWorkspaceEvent: (listener: (evt: WorkspacePushEvent) => void): (() => void) =>
    window.maestro.onWorkspaceEvent((raw) => {
      const parsed = WorkspacePushEventSchema.safeParse(raw)
      if (parsed.success) listener(parsed.data)
    })
}
