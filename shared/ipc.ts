import type {
  AgentAuthStatus,
  AgentType,
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
  ReviewStatus,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalStartResult,
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

  // workspaces
  workspaceCreate: 'maestro:workspace:create',
  workspaceFanOut: 'maestro:workspace:fanOut',
  workspaceList: 'maestro:workspace:list',
  workspaceListAll: 'maestro:workspace:listAll',
  workspaceGet: 'maestro:workspace:get',
  workspaceDiff: 'maestro:workspace:diff',
  workspaceFileDiff: 'maestro:workspace:fileDiff',
  workspaceReviewStatus: 'maestro:workspace:reviewStatus',
  workspaceCommit: 'maestro:workspace:commit',
  workspaceMerge: 'maestro:workspace:merge',
  workspaceCreatePr: 'maestro:workspace:createPr',
  workspaceArchive: 'maestro:workspace:archive',
  workspaceArchiveSiblings: 'maestro:workspace:archiveSiblings',

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
  agentIsAvailable: 'maestro:agent:isAvailable',
  agentAuthStatus: 'maestro:agent:authStatus',
  agentLoginStart: 'maestro:agent:loginStart',
  agentCredentialInfo: 'maestro:agent:credentialInfo',
  agentCredentialSet: 'maestro:agent:credentialSet',
  agentCredentialClear: 'maestro:agent:credentialClear',

  // push channel (main -> renderer)
  workspaceEvent: 'maestro:workspace-event'
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

  // --- workspaces ---
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>
  listWorkspaces(repoPath: string): Promise<Workspace[]>
  listAllWorkspaces(): Promise<Workspace[]>
  getWorkspace(id: string): Promise<Workspace>
  getDiff(id: string): Promise<WorkspaceDiff>
  getFileDiff(id: string, path: string, oldPath?: string): Promise<FileDiff>
  getReviewStatus(id: string): Promise<ReviewStatus>
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

  // --- agents ---
  /** Start an agent turn. Resolves immediately (ack); progress arrives via
   * onWorkspaceEvent. */
  startAgent(workspaceId: string, prompt: string, model?: string): Promise<void>
  cancelAgent(workspaceId: string): Promise<void>
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
