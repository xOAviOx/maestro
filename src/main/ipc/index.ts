import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipc'
import {
  AgentAvailabilityInputSchema,
  ArchiveWorkspaceInputSchema,
  CreateWorkspaceInputSchema,
  FileDiffInputSchema,
  PingRequestSchema,
  RegisterRepoInputSchema,
  RepoPathInputSchema,
  SetFilesToCopyInputSchema,
  StartAgentInputSchema,
  WorkspaceIdInputSchema,
  type PingResponse
} from '@shared/types'
import { toErrorPayload } from '../engine/errors'
import type { Engine } from '../engine'
import type { WorkspaceSupervisor } from '../engine/WorkspaceSupervisor'
import { log } from '../log'

export interface IpcDeps {
  engine: Engine
  supervisor: WorkspaceSupervisor
}

/**
 * Registers every ipcMain.handle handler. Handlers stay thin: validate the
 * incoming payload with its zod schema, delegate to the engine/supervisor, and
 * return a serializable result. Any thrown error is normalized to a serializable
 * ErrorPayload and re-thrown so the renderer's invoke() rejects with a readable
 * message instead of crashing main.
 */
export function registerIpcHandlers(deps: IpcDeps): void {
  const { engine, supervisor } = deps

  // Wrap a handler so all errors become serializable ErrorPayloads.
  const handle = <T>(
    channel: string,
    fn: (raw: unknown) => Promise<T> | T
  ): void => {
    ipcMain.handle(channel, async (_event, raw: unknown) => {
      try {
        return await fn(raw)
      } catch (err) {
        const payload = toErrorPayload(err)
        log.warn('ipc.handler-error', { channel, code: payload.code, message: payload.message })
        // Re-throw a plain Error whose message is the JSON payload; the renderer
        // parses it back into a structured error.
        throw new Error(JSON.stringify(payload))
      }
    })
  }

  handle(IpcChannels.dialogOpenDirectory, async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
    const opts = { title: 'Open a Git repository', properties: ['openDirectory' as const] }
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0] ?? null
  })

  handle(IpcChannels.ping, (raw): PingResponse => {
    const { message } = PingRequestSchema.parse(raw)
    return {
      reply: `pong: ${message}`,
      at: new Date().toISOString(),
      versions: {
        electron: process.versions.electron ?? 'unknown',
        chrome: process.versions.chrome ?? 'unknown',
        node: process.versions.node ?? 'unknown'
      }
    }
  })

  // --- repos ---
  handle(IpcChannels.repoRegister, (raw) => {
    const { repoPath } = RegisterRepoInputSchema.parse(raw)
    return engine.worktrees.registerRepo(repoPath)
  })
  handle(IpcChannels.repoList, () => engine.repos.list())
  handle(IpcChannels.repoGetInfo, (raw) => {
    const { repoPath } = RepoPathInputSchema.parse(raw)
    return engine.worktrees.getRepoInfo(repoPath)
  })
  handle(IpcChannels.repoSetFilesToCopy, (raw) => {
    const { repoPath, patterns } = SetFilesToCopyInputSchema.parse(raw)
    engine.repos.setFilesToCopy(repoPath, patterns)
  })

  // --- workspaces ---
  handle(IpcChannels.workspaceCreate, (raw) => {
    const input = CreateWorkspaceInputSchema.parse(raw)
    return engine.worktrees.createWorkspace(input)
  })
  handle(IpcChannels.workspaceList, (raw) => {
    const { repoPath } = RepoPathInputSchema.parse(raw)
    return engine.worktrees.listWorkspaces(repoPath)
  })
  handle(IpcChannels.workspaceListAll, () => engine.workspaces.listAll(false))
  handle(IpcChannels.workspaceGet, (raw) => {
    const { id } = WorkspaceIdInputSchema.parse(raw)
    return engine.worktrees.getWorkspace(id)
  })
  handle(IpcChannels.workspaceDiff, (raw) => {
    const { id } = WorkspaceIdInputSchema.parse(raw)
    return engine.worktrees.getDiff(id)
  })
  handle(IpcChannels.workspaceFileDiff, (raw) => {
    const { id, path, oldPath } = FileDiffInputSchema.parse(raw)
    return engine.worktrees.getFileDiff(id, path, oldPath)
  })
  handle(IpcChannels.workspaceArchive, (raw) => {
    const { id, force } = ArchiveWorkspaceInputSchema.parse(raw)
    return engine.worktrees.archiveWorkspace(id, force ?? false)
  })

  // --- agents ---
  handle(IpcChannels.agentStart, async (raw) => {
    const { workspaceId, prompt, model } = StartAgentInputSchema.parse(raw)
    await supervisor.startRun(workspaceId, prompt, model)
  })
  handle(IpcChannels.agentCancel, (raw) => {
    const { id } = WorkspaceIdInputSchema.parse(raw)
    supervisor.cancelRun(id)
  })
  handle(IpcChannels.agentIsAvailable, (raw) => {
    const { agentType } = AgentAvailabilityInputSchema.parse(raw)
    return supervisor.isAgentAvailable(agentType)
  })

  log.info('ipc.handlers-registered')
}
