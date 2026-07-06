import type {
  AgentAuthStatus,
  AgentType,
  CreateWorkflowInput,
  CreateWorkspaceInput,
  CredentialInfo,
  CredentialKind,
  EnqueueJobInput,
  FanOutInput,
  FileDiff,
  MergeResult,
  PingResponse,
  PullRequestResult,
  QueuedJob,
  RepoInfo,
  RepoRecord,
  ReviewEvent,
  ReviewStatus,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalStartResult,
  TestResult,
  UsageEvent,
  UsageListInput,
  UsageSummary,
  Workflow,
  WorkflowPushEvent,
  Workspace,
  WorkspaceDiff,
  WorkspacePushEvent
} from './types'

/**
 * IPC channel names. Centralized so main (ipcMain.handle) and preload
 * (ipcRenderer.invoke) never disagree on a magic string.
 */
export const IpcChannels = {
  ping: 'maestro:ping',

  // dialogs
  dialogOpenDirectory: 'maestro:dialog:openDirectory',

  // shell
  openExternal: 'maestro:shell:openExternal',

  // repos
  repoRegister: 'maestro:repo:register',
  repoList: 'maestro:repo:list',
  repoGetInfo: 'maestro:repo:getInfo',
  repoSetFilesToCopy: 'maestro:repo:setFilesToCopy',
  repoSetTestCommand: 'maestro:repo:setTestCommand',

  // workspaces
  workspaceCreate: 'maestro:workspace:create',
  workspaceFanOut: 'maestro:workspace:fanOut',
  workspaceList: 'maestro:workspace:list',
  workspaceListAll: 'maestro:workspace:listAll',
  workspaceGet: 'maestro:workspace:get',
  workspaceDiff: 'maestro:workspace:diff',
  workspaceFileDiff: 'maestro:workspace:fileDiff',
  workspaceReviewStatus: 'maestro:workspace:reviewStatus',
  workspaceReviewHistory: 'maestro:workspace:reviewHistory',
  workspaceCommit: 'maestro:workspace:commit',
  workspaceMerge: 'maestro:workspace:merge',
  workspaceCreatePr: 'maestro:workspace:createPr',
  workspaceArchive: 'maestro:workspace:archive',
  workspaceArchiveSiblings: 'maestro:workspace:archiveSiblings',
  workspaceRunTests: 'maestro:workspace:runTests',

  // integrations
  ghAvailable: 'maestro:gh:available',

  // terminal (node-pty)
  terminalStart: 'maestro:terminal:start',
  terminalInput: 'maestro:terminal:input',
  terminalResize: 'maestro:terminal:resize',
  terminalDispose: 'maestro:terminal:dispose',
  terminalData: 'maestro:terminal:data', // push
  terminalExit: 'maestro:terminal:exit', // push

  // agents
  agentStart: 'maestro:agent:start',
  agentCancel: 'maestro:agent:cancel',
  agentEnqueue: 'maestro:agent:enqueue',
  agentQueueList: 'maestro:agent:queueList',
  agentJobCancel: 'maestro:agent:jobCancel',
  agentIsAvailable: 'maestro:agent:isAvailable',
  agentAuthStatus: 'maestro:agent:authStatus',
  agentLoginStart: 'maestro:agent:loginStart',
  agentCredentialInfo: 'maestro:agent:credentialInfo',
  agentCredentialSet: 'maestro:agent:credentialSet',
  agentCredentialClear: 'maestro:agent:credentialClear',

  // workflows (Module 9 — DAG scheduler)
  workflowCreate: 'maestro:workflow:create',
  workflowList: 'maestro:workflow:list',
  workflowGet: 'maestro:workflow:get',
  workflowStart: 'maestro:workflow:start',
  workflowPause: 'maestro:workflow:pause',
  workflowResume: 'maestro:workflow:resume',
  taskApprove: 'maestro:task:approve',
  taskReject: 'maestro:task:reject',
  taskRetry: 'maestro:task:retry',
  taskCascadePreview: 'maestro:task:cascadePreview',

  // usage & cost (Module 13 — collection pipeline)
  usageList: 'maestro:usage:list',
  usageSummary: 'maestro:usage:summary',

  // push channels (main -> renderer)
  workspaceEvent: 'maestro:workspace-event',
  workflowEvent: 'maestro:workflow-event'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

/**
 * The typed API surface exposed on `window.maestro` by the preload script.
 * The renderer programs against this interface; the preload implements it.
 * Single source of truth for what the renderer can ask main to do.
 */
export interface MaestroApi {
  /** Connectivity smoke test. */
  ping(message: string): Promise<PingResponse>

  /** Show a native folder picker; resolves to the chosen path or null if cancelled. */
  openDirectoryDialog(): Promise<string | null>

  /** Open a URL in the user's default browser (for agent login OAuth links). */
  openExternal(url: string): Promise<void>

  // --- repos ---
  registerRepo(repoPath: string): Promise<RepoInfo>
  listRepos(): Promise<RepoRecord[]>
  getRepoInfo(repoPath: string): Promise<RepoInfo>
  setFilesToCopy(repoPath: string, patterns: string[]): Promise<void>
  /** Set the per-repo test command (empty string clears it). */
  setTestCommand(repoPath: string, testCommand: string): Promise<void>

  // --- workspaces ---
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>
  /** Launch one task as N competing variants (fan-out). Returns the variant
   * workspaces; their first turns are started automatically by main. */
  fanOut(input: FanOutInput): Promise<Workspace[]>
  listWorkspaces(repoPath: string): Promise<Workspace[]>
  listAllWorkspaces(): Promise<Workspace[]>
  getWorkspace(id: string): Promise<Workspace>
  getDiff(id: string): Promise<WorkspaceDiff>
  getFileDiff(id: string, path: string, oldPath?: string): Promise<FileDiff>
  getReviewStatus(id: string): Promise<ReviewStatus>
  /** Persisted history of merge/PR outcomes for a workspace (newest first). */
  listReviewHistory(id: string): Promise<ReviewEvent[]>
  commitWorkspace(id: string, message: string): Promise<boolean>
  mergeWorkspace(
    id: string,
    options?: { commitMessage?: string; archiveAfter?: boolean }
  ): Promise<MergeResult>
  createPullRequest(
    id: string,
    options?: { title?: string; body?: string; commitMessage?: string }
  ): Promise<PullRequestResult>
  archiveWorkspace(id: string, force?: boolean): Promise<void>
  /** Archive every other (non-archived) variant in this workspace's fan-out
   * group, keeping only `id`. No-op if the workspace isn't part of a group. */
  archiveSiblings(id: string): Promise<void>
  /** Run the repo's configured test command inside this workspace's worktree;
   * resolves with the captured pass/fail result. */
  runTests(id: string): Promise<TestResult>

  // --- agents ---
  /** Start an agent turn. Resolves immediately (ack); progress arrives via
   * onWorkspaceEvent. */
  startAgent(workspaceId: string, prompt: string, model?: string): Promise<void>
  cancelAgent(workspaceId: string): Promise<void>
  /** Enqueue an agent turn. Runs FIFO when its workspace is free and its
   * dependency (if any) has finished. Returns the created job. */
  enqueueJob(input: EnqueueJobInput): Promise<QueuedJob>
  /** The current pending-job queue (also pushed via onWorkspaceEvent). */
  listQueue(): Promise<QueuedJob[]>
  /** Remove a pending job from the queue (no effect once it has started). */
  cancelJob(jobId: string): Promise<void>
  isAgentAvailable(agentType: AgentType): Promise<boolean>
  /** Detect whether an agent's CLI is installed and logged in. */
  getAgentAuthStatus(agentType: AgentType): Promise<AgentAuthStatus>
  /**
   * Start the agent CLI's interactive login flow in a pty. Output streams over
   * the terminal data/exit channels keyed by the returned `sessionKey`; bind an
   * xterm to it (see onTerminalData/onTerminalExit) so the user can complete the
   * CLI's own OAuth handshake. Resolves to the session key, or null if the CLI
   * isn't installed.
   */
  startAgentLogin(
    agentType: AgentType,
    cols: number,
    rows: number
  ): Promise<{ sessionKey: string } | null>
  /** Non-secret info about a stored headless credential (Advanced fallback). */
  getCredentialInfo(agentType: AgentType): Promise<CredentialInfo>
  /** Store an encrypted headless credential (write-only; never read back). */
  setCredential(agentType: AgentType, kind: CredentialKind, secret: string): Promise<CredentialInfo>
  /** Remove a stored headless credential. */
  clearCredential(agentType: AgentType): Promise<CredentialInfo>

  // --- workflows (DAG scheduler) ---
  /** Validate (cycles/dangling edges rejected) and persist a new workflow (draft). */
  createWorkflow(input: CreateWorkflowInput): Promise<Workflow>
  listWorkflows(): Promise<Workflow[]>
  getWorkflow(id: string): Promise<Workflow>
  /** Begin scheduling: promote ready tasks and spawn up to maxConcurrency. */
  startWorkflow(id: string): Promise<Workflow>
  /** Stop spawning new agents; running agents finish. */
  pauseWorkflow(id: string): Promise<Workflow>
  resumeWorkflow(id: string): Promise<Workflow>
  /** Approve a completed task's diff → merge it (serially) → release children. */
  approveTask(workflowId: string, taskId: string): Promise<Workflow>
  /** Reject a completed task: 'cascade' cancels descendants; 'retry' re-queues it. */
  rejectTask(
    workflowId: string,
    taskId: string,
    mode?: 'cascade' | 'retry',
    prompt?: string
  ): Promise<Workflow>
  /** Manually retry a failed task. */
  retryTask(workflowId: string, taskId: string): Promise<Workflow>
  /** Task ids a cascade rejection of this task would cancel (for a confirm dialog). */
  previewCascade(workflowId: string, taskId: string): Promise<string[]>
  /** Subscribe to workflow snapshot push events. Returns an unsubscribe function. */
  onWorkflowEvent(listener: (evt: WorkflowPushEvent) => void): () => void

  // --- usage & cost (collection pipeline) ---
  /** Persisted per-turn usage samples, newest first. Optionally filtered to one
   * workspace and/or capped to the most recent `limit` events. New samples are
   * also pushed live via onWorkspaceEvent ('usage_recorded'). */
  listUsage(input?: UsageListInput): Promise<UsageEvent[]>
  /** Token totals + best-effort cost rollup (per-event model rates; the CLI's
   * own reported cost wins when present). Omit workspaceId for all usage. */
  getUsageSummary(workspaceId?: string): Promise<UsageSummary>

  // --- integrations ---
  isGhAvailable(): Promise<boolean>

  // --- terminal (node-pty) ---
  /** Start (or re-attach to) the shell for a workspace; returns replay buffer. */
  startTerminal(workspaceId: string, cols: number, rows: number): Promise<TerminalStartResult>
  /** Send keystrokes to the workspace's shell (fire-and-forget). */
  sendTerminalInput(workspaceId: string, data: string): void
  /** Resize the workspace's shell (fire-and-forget). */
  resizeTerminal(workspaceId: string, cols: number, rows: number): void
  /** Kill the workspace's shell. */
  disposeTerminal(workspaceId: string): Promise<void>
  onTerminalData(listener: (evt: TerminalDataEvent) => void): () => void
  onTerminalExit(listener: (evt: TerminalExitEvent) => void): () => void

  // --- push subscription ---
  /** Subscribe to workspace push events. Returns an unsubscribe function. */
  onWorkspaceEvent(listener: (evt: WorkspacePushEvent) => void): () => void
}
