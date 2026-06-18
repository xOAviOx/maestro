import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { z } from 'zod'
import { IpcChannels } from '@shared/ipc'
import {
  AgentAvailabilityInputSchema,
  AgentLoginInputSchema,
  ArchiveWorkspaceInputSchema,
  CommitWorkspaceInputSchema,
  CreatePrInputSchema,
  CreateWorkspaceInputSchema,
  EnqueueJobInputSchema,
  FanOutInputSchema,
  FileDiffInputSchema,
  MergeWorkspaceInputSchema,
  PingRequestSchema,
  RegisterRepoInputSchema,
  RepoPathInputSchema,
  RunTestsInputSchema,
  SetCredentialInputSchema,
  SetFilesToCopyInputSchema,
  SetTestCommandInputSchema,
  StartAgentInputSchema,
  TerminalInputSchema,
  TerminalResizeSchema,
  TerminalStartInputSchema,
  WorkspaceIdInputSchema,
  type PingResponse,
  type TerminalStartResult
} from '@shared/types'
import { toErrorPayload } from '../engine/errors'
import { getAgentAuthStatus, resolveLoginCommand } from '../harness'
import { maestroHome } from '../engine/util/paths'
import type { Engine } from '../engine'
import type { WorkspaceSupervisor } from '../engine/WorkspaceSupervisor'
import type { PtyManager } from '../terminal/PtyManager'
import { log } from '../log'

export interface IpcDeps {
  engine: Engine
  supervisor: WorkspaceSupervisor
  ptyManager: PtyManager
}

/**
 * Registers every ipcMain.handle handler. Handlers stay thin: validate the
 * incoming payload with its zod schema, delegate to the engine/supervisor, and
 * return a serializable result. Any thrown error is normalized to a serializable
 * ErrorPayload and re-thrown so the renderer's invoke() rejects with a readable
 * message instead of crashing main.
 */
export function registerIpcHandlers(deps: IpcDeps): void {
  const { engine, supervisor, ptyManager } = deps

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

  handle(IpcChannels.openExternal, async (raw): Promise<void> => {
    const { url } = z.object({ url: z.string().url() }).parse(raw)
    // Only ever hand http(s) URLs to the OS browser — never file:// or custom
    // schemes that could trigger unexpected local handlers.
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Refusing to open non-web URL: ${parsed.protocol}`)
    }
    await shell.openExternal(url)
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
  handle(IpcChannels.repoSetTestCommand, (raw) => {
    const { repoPath, testCommand } = SetTestCommandInputSchema.parse(raw)
    engine.repos.setTestCommand(repoPath, testCommand.trim() === '' ? null : testCommand)
  })

  // --- workspaces ---
  handle(IpcChannels.workspaceCreate, (raw) => {
    const input = CreateWorkspaceInputSchema.parse(raw)
    return engine.worktrees.createWorkspace(input)
  })
  handle(IpcChannels.workspaceFanOut, async (raw) => {
    const input = FanOutInputSchema.parse(raw)
    const workspaces = await engine.worktrees.createFanOut(input)
    // Kick off each variant's first turn with that variant's model (variant
    // order matches workspace order from createFanOut).
    await Promise.all(
      workspaces.map((ws, i) =>
        supervisor.startRun(ws.id, input.prompt, input.variants[i]?.model)
      )
    )
    return workspaces
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
  handle(IpcChannels.workspaceReviewStatus, (raw) => {
    const { id } = WorkspaceIdInputSchema.parse(raw)
    return engine.worktrees.getReviewStatus(id)
  })
  handle(IpcChannels.workspaceCommit, (raw) => {
    const { id, message } = CommitWorkspaceInputSchema.parse(raw)
    return engine.worktrees.commitWorkspace(id, message)
  })
  handle(IpcChannels.workspaceMerge, (raw) => {
    const { id, commitMessage, archiveAfter } = MergeWorkspaceInputSchema.parse(raw)
    return engine.worktrees.mergeWorkspace(id, { commitMessage, archiveAfter })
  })
  handle(IpcChannels.workspaceCreatePr, (raw) => {
    const { id, title, body, commitMessage } = CreatePrInputSchema.parse(raw)
    return engine.worktrees.createPullRequest(id, { title, body, commitMessage })
  })
  handle(IpcChannels.workspaceArchive, (raw) => {
    const { id, force } = ArchiveWorkspaceInputSchema.parse(raw)
    return engine.worktrees.archiveWorkspace(id, force ?? false)
  })
  handle(IpcChannels.workspaceArchiveSiblings, async (raw) => {
    const { id } = WorkspaceIdInputSchema.parse(raw)
    const ws = await engine.worktrees.getWorkspace(id)
    if (ws.groupId) await engine.worktrees.archiveGroupExcept(ws.groupId, id)
  })
  handle(IpcChannels.workspaceRunTests, (raw) => {
    const { id } = RunTestsInputSchema.parse(raw)
    return engine.tests.run(id)
  })

  // --- integrations ---
  handle(IpcChannels.ghAvailable, () => engine.worktrees.isGhAvailable())

  // --- agents ---
  handle(IpcChannels.agentStart, async (raw) => {
    const { workspaceId, prompt, model } = StartAgentInputSchema.parse(raw)
    await supervisor.startRun(workspaceId, prompt, model)
  })
  handle(IpcChannels.agentCancel, (raw) => {
    const { id } = WorkspaceIdInputSchema.parse(raw)
    supervisor.cancelRun(id)
  })
  handle(IpcChannels.agentEnqueue, (raw) => {
    const input = EnqueueJobInputSchema.parse(raw)
    return supervisor.enqueue(input)
  })
  handle(IpcChannels.agentQueueList, () => supervisor.listQueue())
  handle(IpcChannels.agentJobCancel, (raw) => {
    const { id } = WorkspaceIdInputSchema.parse(raw)
    supervisor.cancelJob(id)
  })
  handle(IpcChannels.agentIsAvailable, (raw) => {
    const { agentType } = AgentAvailabilityInputSchema.parse(raw)
    return supervisor.isAgentAvailable(agentType)
  })
  handle(IpcChannels.agentAuthStatus, (raw) => {
    const { agentType } = AgentAvailabilityInputSchema.parse(raw)
    return getAgentAuthStatus(agentType)
  })
  handle(
    IpcChannels.agentLoginStart,
    async (raw): Promise<{ sessionKey: string } | null> => {
      const { agentType, cols, rows } = AgentLoginInputSchema.parse(raw)
      const cmd = await resolveLoginCommand(agentType)
      if (!cmd) return null
      // Reserved key namespace so a login pty can never collide with a
      // workspace shell (workspace keys are uuids). The renderer binds an xterm
      // to this key via the terminal data/exit channels.
      const sessionKey = `login:${agentType}`
      // Run the login flow from the Maestro data dir (a stable, writable cwd).
      ptyManager.startCommand(sessionKey, cmd.file, cmd.args, maestroHome(), cols, rows)
      return { sessionKey }
    }
  )
  handle(IpcChannels.agentCredentialInfo, (raw) => {
    const { agentType } = AgentAvailabilityInputSchema.parse(raw)
    return engine.credentials.info(agentType)
  })
  handle(IpcChannels.agentCredentialSet, (raw) => {
    const { agentType, kind, secret } = SetCredentialInputSchema.parse(raw)
    engine.credentials.set(agentType, kind, secret)
    return engine.credentials.info(agentType)
  })
  handle(IpcChannels.agentCredentialClear, (raw) => {
    const { agentType } = AgentAvailabilityInputSchema.parse(raw)
    engine.credentials.clear(agentType)
    return engine.credentials.info(agentType)
  })

  // --- terminal (node-pty) ---
  handle(IpcChannels.terminalStart, async (raw): Promise<TerminalStartResult> => {
    const { workspaceId, cols, rows } = TerminalStartInputSchema.parse(raw)
    const ws = await engine.worktrees.getWorkspace(workspaceId) // throws if not found
    const buffer = ptyManager.start(workspaceId, ws.worktreePath, cols, rows)
    return { buffer }
  })
  handle(IpcChannels.terminalDispose, (raw) => {
    const { id } = WorkspaceIdInputSchema.parse(raw)
    ptyManager.dispose(id)
  })
  // Input/resize are high-frequency and one-way (no ack needed).
  ipcMain.on(IpcChannels.terminalInput, (_event, raw: unknown) => {
    try {
      const { workspaceId, data } = TerminalInputSchema.parse(raw)
      ptyManager.write(workspaceId, data)
    } catch (err) {
      log.warn('ipc.terminal-input-error', { message: String(err) })
    }
  })
  ipcMain.on(IpcChannels.terminalResize, (_event, raw: unknown) => {
    try {
      const { workspaceId, cols, rows } = TerminalResizeSchema.parse(raw)
      ptyManager.resize(workspaceId, cols, rows)
    } catch {
      // ignore malformed resize
    }
  })

  log.info('ipc.handlers-registered')
}
