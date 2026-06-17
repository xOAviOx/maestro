import type {
  AgentType,
  CreateWorkspaceInput,
  FileDiff,
  PingResponse,
  RepoInfo,
  RepoRecord,
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

  // repos
  repoRegister: 'maestro:repo:register',
  repoList: 'maestro:repo:list',
  repoGetInfo: 'maestro:repo:getInfo',
  repoSetFilesToCopy: 'maestro:repo:setFilesToCopy',

  // workspaces
  workspaceCreate: 'maestro:workspace:create',
  workspaceList: 'maestro:workspace:list',
  workspaceListAll: 'maestro:workspace:listAll',
  workspaceGet: 'maestro:workspace:get',
  workspaceDiff: 'maestro:workspace:diff',
  workspaceFileDiff: 'maestro:workspace:fileDiff',
  workspaceArchive: 'maestro:workspace:archive',

  // agents
  agentStart: 'maestro:agent:start',
  agentCancel: 'maestro:agent:cancel',
  agentIsAvailable: 'maestro:agent:isAvailable',

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
  archiveWorkspace(id: string, force?: boolean): Promise<void>

  // --- agents ---
  /** Start an agent turn. Resolves immediately (ack); progress arrives via
   * onWorkspaceEvent. */
  startAgent(workspaceId: string, prompt: string, model?: string): Promise<void>
  cancelAgent(workspaceId: string): Promise<void>
  isAgentAvailable(agentType: AgentType): Promise<boolean>

  // --- push subscription ---
  /** Subscribe to workspace push events. Returns an unsubscribe function. */
  onWorkspaceEvent(listener: (evt: WorkspacePushEvent) => void): () => void
}
