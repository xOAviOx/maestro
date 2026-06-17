import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '@shared/ipc'
import type { MaestroApi } from '@shared/ipc'
import type {
  AgentType,
  CredentialKind,
  CreateWorkspaceInput,
  TerminalDataEvent,
  TerminalExitEvent,
  WorkspacePushEvent
} from '@shared/types'

/**
 * The single bridge between the sandboxed renderer and the main process.
 *
 * Hard constraint: the renderer never touches fs/child_process/node-pty. It only
 * sees `window.maestro`, this typed surface. Each method forwards to a named IPC
 * channel; main validates the request payload there. Push events are forwarded
 * raw — the renderer re-validates them with zod in `src/renderer/ipc.ts` (which
 * is also where invoke rejections are parsed back into structured errors). This
 * keeps the preload a thin, dependency-free pass-through suitable for `sandbox: true`.
 */
const api: MaestroApi = {
  ping: (message: string) => ipcRenderer.invoke(IpcChannels.ping, { message }),

  openDirectoryDialog: () => ipcRenderer.invoke(IpcChannels.dialogOpenDirectory),

  // repos
  registerRepo: (repoPath: string) => ipcRenderer.invoke(IpcChannels.repoRegister, { repoPath }),
  listRepos: () => ipcRenderer.invoke(IpcChannels.repoList),
  getRepoInfo: (repoPath: string) => ipcRenderer.invoke(IpcChannels.repoGetInfo, { repoPath }),
  setFilesToCopy: (repoPath: string, patterns: string[]) =>
    ipcRenderer.invoke(IpcChannels.repoSetFilesToCopy, { repoPath, patterns }),

  // workspaces
  createWorkspace: (input: CreateWorkspaceInput) =>
    ipcRenderer.invoke(IpcChannels.workspaceCreate, input),
  listWorkspaces: (repoPath: string) => ipcRenderer.invoke(IpcChannels.workspaceList, { repoPath }),
  listAllWorkspaces: () => ipcRenderer.invoke(IpcChannels.workspaceListAll),
  getWorkspace: (id: string) => ipcRenderer.invoke(IpcChannels.workspaceGet, { id }),
  getDiff: (id: string) => ipcRenderer.invoke(IpcChannels.workspaceDiff, { id }),
  getFileDiff: (id: string, path: string, oldPath?: string) =>
    ipcRenderer.invoke(IpcChannels.workspaceFileDiff, { id, path, oldPath }),
  getReviewStatus: (id: string) => ipcRenderer.invoke(IpcChannels.workspaceReviewStatus, { id }),
  commitWorkspace: (id: string, message: string) =>
    ipcRenderer.invoke(IpcChannels.workspaceCommit, { id, message }),
  mergeWorkspace: (id: string, options?: { commitMessage?: string; archiveAfter?: boolean }) =>
    ipcRenderer.invoke(IpcChannels.workspaceMerge, { id, ...options }),
  createPullRequest: (
    id: string,
    options?: { title?: string; body?: string; commitMessage?: string }
  ) => ipcRenderer.invoke(IpcChannels.workspaceCreatePr, { id, ...options }),
  archiveWorkspace: (id: string, force?: boolean) =>
    ipcRenderer.invoke(IpcChannels.workspaceArchive, { id, force }),

  // agents
  startAgent: (workspaceId: string, prompt: string, model?: string) =>
    ipcRenderer.invoke(IpcChannels.agentStart, { workspaceId, prompt, model }),
  cancelAgent: (workspaceId: string) =>
    ipcRenderer.invoke(IpcChannels.agentCancel, { id: workspaceId }),
  isAgentAvailable: (agentType: AgentType) =>
    ipcRenderer.invoke(IpcChannels.agentIsAvailable, { agentType }),
  getAgentAuthStatus: (agentType: AgentType) =>
    ipcRenderer.invoke(IpcChannels.agentAuthStatus, { agentType }),
  startAgentLogin: (agentType: AgentType, cols: number, rows: number) =>
    ipcRenderer.invoke(IpcChannels.agentLoginStart, { agentType, cols, rows }),
  getCredentialInfo: (agentType: AgentType) =>
    ipcRenderer.invoke(IpcChannels.agentCredentialInfo, { agentType }),
  setCredential: (agentType: AgentType, kind: CredentialKind, secret: string) =>
    ipcRenderer.invoke(IpcChannels.agentCredentialSet, { agentType, kind, secret }),
  clearCredential: (agentType: AgentType) =>
    ipcRenderer.invoke(IpcChannels.agentCredentialClear, { agentType }),

  // integrations
  isGhAvailable: () => ipcRenderer.invoke(IpcChannels.ghAvailable),

  // terminal
  startTerminal: (workspaceId: string, cols: number, rows: number) =>
    ipcRenderer.invoke(IpcChannels.terminalStart, { workspaceId, cols, rows }),
  sendTerminalInput: (workspaceId: string, data: string): void =>
    ipcRenderer.send(IpcChannels.terminalInput, { workspaceId, data }),
  resizeTerminal: (workspaceId: string, cols: number, rows: number): void =>
    ipcRenderer.send(IpcChannels.terminalResize, { workspaceId, cols, rows }),
  disposeTerminal: (workspaceId: string) =>
    ipcRenderer.invoke(IpcChannels.terminalDispose, { id: workspaceId }),
  onTerminalData: (listener: (evt: TerminalDataEvent) => void) => {
    const channelListener = (_e: unknown, payload: unknown): void =>
      listener(payload as TerminalDataEvent)
    ipcRenderer.on(IpcChannels.terminalData, channelListener)
    return () => {
      ipcRenderer.removeListener(IpcChannels.terminalData, channelListener)
    }
  },
  onTerminalExit: (listener: (evt: TerminalExitEvent) => void) => {
    const channelListener = (_e: unknown, payload: unknown): void =>
      listener(payload as TerminalExitEvent)
    ipcRenderer.on(IpcChannels.terminalExit, channelListener)
    return () => {
      ipcRenderer.removeListener(IpcChannels.terminalExit, channelListener)
    }
  },

  // push subscription — payload re-validated in the renderer
  onWorkspaceEvent: (listener: (evt: WorkspacePushEvent) => void) => {
    const channelListener = (_e: unknown, payload: unknown): void => {
      // Forwarded raw; renderer's ipc.ts validates before app code sees it.
      listener(payload as WorkspacePushEvent)
    }
    ipcRenderer.on(IpcChannels.workspaceEvent, channelListener)
    return () => {
      ipcRenderer.removeListener(IpcChannels.workspaceEvent, channelListener)
    }
  }
}

contextBridge.exposeInMainWorld('maestro', api)
