import { z } from 'zod'
import {
  ErrorPayloadSchema,
  FileDiffSchema,
  PingResponseSchema,
  RepoInfoSchema,
  RepoRecordSchema,
  WorkspaceDiffSchema,
  WorkspacePushEventSchema,
  WorkspaceSchema,
  type AgentType,
  type CreateWorkspaceInput,
  type FileDiff,
  type MaestroErrorCode,
  type PingResponse,
  type RepoInfo,
  type RepoRecord,
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

  // repos
  registerRepo: (repoPath: string): Promise<RepoInfo> =>
    call(window.maestro.registerRepo(repoPath), RepoInfoSchema),
  listRepos: (): Promise<RepoRecord[]> =>
    call(window.maestro.listRepos(), z.array(RepoRecordSchema)),
  getRepoInfo: (repoPath: string): Promise<RepoInfo> =>
    call(window.maestro.getRepoInfo(repoPath), RepoInfoSchema),
  setFilesToCopy: (repoPath: string, patterns: string[]): Promise<void> =>
    callVoid(window.maestro.setFilesToCopy(repoPath, patterns)),

  // workspaces
  createWorkspace: (input: CreateWorkspaceInput): Promise<Workspace> =>
    call(window.maestro.createWorkspace(input), WorkspaceSchema),
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
  archiveWorkspace: (id: string, force?: boolean): Promise<void> =>
    callVoid(window.maestro.archiveWorkspace(id, force)),

  // agents
  startAgent: (workspaceId: string, prompt: string, model?: string): Promise<void> =>
    callVoid(window.maestro.startAgent(workspaceId, prompt, model)),
  cancelAgent: (workspaceId: string): Promise<void> =>
    callVoid(window.maestro.cancelAgent(workspaceId)),
  isAgentAvailable: (agentType: AgentType): Promise<boolean> =>
    call(window.maestro.isAgentAvailable(agentType), z.boolean()),

  // push subscription — re-validate every event before app code sees it
  onWorkspaceEvent: (listener: (evt: WorkspacePushEvent) => void): (() => void) =>
    window.maestro.onWorkspaceEvent((raw) => {
      const parsed = WorkspacePushEventSchema.safeParse(raw)
      if (parsed.success) listener(parsed.data)
    })
}
