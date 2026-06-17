import { create } from 'zustand'
import { ipc, MaestroClientError } from './ipc'
import type {
  AgentEvent,
  AgentType,
  RepoInfo,
  RepoRecord,
  Workspace,
  WorkspacePushEvent
} from '@shared/types'

/**
 * Renderer state. The renderer is "dumb": it reflects what main reports and
 * dispatches intents through `ipc`. Agent progress arrives via push events
 * (subscribed once in `init`) and is appended to per-workspace chat transcripts.
 *
 * Chat transcripts are kept in memory for the session (per the brief), keyed by
 * workspace id.
 */

/** One item in a workspace's chat transcript: a user prompt or an agent event. */
export type ChatItem = {
  id: string
  at: string
} & ({ source: 'user'; text: string } | { source: 'agent'; event: AgentEvent })

let idCounter = 0
function nextId(): string {
  idCounter += 1
  return `${Date.now().toString(36)}-${idCounter}`
}

function errMessage(err: unknown): string {
  if (err instanceof MaestroClientError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}

interface MaestroState {
  // data
  repos: RepoRecord[]
  activeRepoPath: string | null
  repoInfo: RepoInfo | null
  workspaces: Workspace[]
  selectedWorkspaceId: string | null
  chats: Record<string, ChatItem[]>
  claudeAvailable: boolean

  // ui
  loading: boolean
  error: string | null

  // internal
  _initialized: boolean

  // actions
  init: () => Promise<void>
  openRepo: () => Promise<void>
  selectRepo: (repoPath: string) => Promise<void>
  refreshWorkspaces: () => Promise<void>
  createWorkspace: (name: string, baseBranch: string, agentType: AgentType) => Promise<void>
  selectWorkspace: (id: string) => void
  sendPrompt: (workspaceId: string, prompt: string) => Promise<void>
  cancelAgent: (workspaceId: string) => Promise<void>
  archiveWorkspace: (id: string) => Promise<void>
  clearError: () => void
  _handlePush: (evt: WorkspacePushEvent) => void
}

export const useStore = create<MaestroState>((set, get) => ({
  repos: [],
  activeRepoPath: null,
  repoInfo: null,
  workspaces: [],
  selectedWorkspaceId: null,
  chats: {},
  claudeAvailable: false,

  loading: false,
  error: null,
  _initialized: false,

  init: async () => {
    if (get()._initialized) return
    set({ _initialized: true })

    // Subscribe to push events exactly once.
    ipc.onWorkspaceEvent((evt) => get()._handlePush(evt))

    try {
      const [repos, claudeAvailable] = await Promise.all([
        ipc.listRepos(),
        ipc.isAgentAvailable('claude-code')
      ])
      set({ repos, claudeAvailable })
      const first = repos[0]
      if (first) await get().selectRepo(first.path)
    } catch (err) {
      set({ error: errMessage(err) })
    }
  },

  openRepo: async () => {
    try {
      const dir = await ipc.openDirectoryDialog()
      if (!dir) return
      set({ loading: true, error: null })
      const info = await ipc.registerRepo(dir)
      const repos = await ipc.listRepos()
      set({ repos })
      await get().selectRepo(info.path)
    } catch (err) {
      set({ error: errMessage(err) })
    } finally {
      set({ loading: false })
    }
  },

  selectRepo: async (repoPath: string) => {
    set({ loading: true, error: null, activeRepoPath: repoPath })
    try {
      const [repoInfo, workspaces] = await Promise.all([
        ipc.getRepoInfo(repoPath),
        ipc.listWorkspaces(repoPath)
      ])
      const selectedWorkspaceId = workspaces[0]?.id ?? null
      set({ repoInfo, workspaces, selectedWorkspaceId })
    } catch (err) {
      set({ error: errMessage(err) })
    } finally {
      set({ loading: false })
    }
  },

  refreshWorkspaces: async () => {
    const repoPath = get().activeRepoPath
    if (!repoPath) return
    try {
      const workspaces = await ipc.listWorkspaces(repoPath)
      set({ workspaces })
    } catch (err) {
      set({ error: errMessage(err) })
    }
  },

  createWorkspace: async (name, baseBranch, agentType) => {
    const repoPath = get().activeRepoPath
    if (!repoPath) return
    set({ loading: true, error: null })
    try {
      const ws = await ipc.createWorkspace({ repoPath, name, baseBranch, agentType })
      set((s) => ({ workspaces: [ws, ...s.workspaces], selectedWorkspaceId: ws.id }))
    } catch (err) {
      set({ error: errMessage(err) })
    } finally {
      set({ loading: false })
    }
  },

  selectWorkspace: (id: string) => set({ selectedWorkspaceId: id }),

  sendPrompt: async (workspaceId, prompt) => {
    // Optimistically show the user's message in the transcript.
    set((s) => ({
      chats: {
        ...s.chats,
        [workspaceId]: [
          ...(s.chats[workspaceId] ?? []),
          { id: nextId(), at: new Date().toISOString(), source: 'user', text: prompt }
        ]
      }
    }))
    try {
      await ipc.startAgent(workspaceId, prompt)
    } catch (err) {
      set({ error: errMessage(err) })
    }
  },

  cancelAgent: async (workspaceId) => {
    try {
      await ipc.cancelAgent(workspaceId)
    } catch (err) {
      set({ error: errMessage(err) })
    }
  },

  archiveWorkspace: async (id) => {
    set({ loading: true, error: null })
    try {
      await ipc.archiveWorkspace(id)
      set((s) => {
        const workspaces = s.workspaces.filter((w) => w.id !== id)
        const selectedWorkspaceId =
          s.selectedWorkspaceId === id ? (workspaces[0]?.id ?? null) : s.selectedWorkspaceId
        return { workspaces, selectedWorkspaceId }
      })
    } catch (err) {
      set({ error: errMessage(err) })
    } finally {
      set({ loading: false })
    }
  },

  clearError: () => set({ error: null }),

  _handlePush: (evt) => {
    if (evt.type === 'status_changed') {
      set((s) => ({
        workspaces: s.workspaces.map((w) =>
          w.id === evt.workspaceId ? { ...w, status: evt.status } : w
        )
      }))
      return
    }
    // agent_event -> append to transcript
    set((s) => ({
      chats: {
        ...s.chats,
        [evt.workspaceId]: [
          ...(s.chats[evt.workspaceId] ?? []),
          { id: nextId(), at: new Date().toISOString(), source: 'agent', event: evt.event }
        ]
      }
    }))
  }
}))
