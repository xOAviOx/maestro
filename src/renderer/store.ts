import { create } from 'zustand'
import { ipc, MaestroClientError } from './ipc'
import type {
  AgentAuthStatus,
  AgentEvent,
  AgentType,
  CredentialInfo,
  CredentialKind,
  FanOutVariant,
  QueuedJob,
  RepoInfo,
  RepoRecord,
  TestResult,
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
  /** Pending queued jobs across all workspaces (renderer filters by workspace). */
  queue: QueuedJob[]
  /** Latest test result per workspace id (session-only, like chats). */
  testResults: Record<string, TestResult>
  /** Per-workspace "tests running" flag, so variants can run independently. */
  testRunning: Record<string, boolean>
  claudeAvailable: boolean
  ghAvailable: boolean
  /** Per-agent install + login state, shown in the Accounts settings panel. */
  agentAuth: Record<AgentType, AgentAuthStatus>
  /** Per-agent stored-credential metadata (Advanced headless fallback). */
  agentCredentials: Record<AgentType, CredentialInfo>

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
  refreshAgentAuth: () => Promise<void>
  setCredential: (agentType: AgentType, kind: CredentialKind, secret: string) => Promise<void>
  clearCredential: (agentType: AgentType) => Promise<void>
  createWorkspace: (name: string, baseBranch: string, agentType: AgentType) => Promise<void>
  fanOut: (
    name: string,
    baseBranch: string,
    prompt: string,
    variants: FanOutVariant[]
  ) => Promise<void>
  archiveSiblings: (workspaceId: string) => Promise<void>
  setTestCommand: (repoPath: string, testCommand: string) => Promise<void>
  runTests: (workspaceId: string) => Promise<void>
  runTestsForGroup: (workspaceIds: string[]) => Promise<void>
  selectWorkspace: (id: string) => void
  sendPrompt: (workspaceId: string, prompt: string) => Promise<void>
  enqueueJob: (workspaceId: string, prompt: string, dependsOnWorkspaceId?: string) => Promise<void>
  cancelJob: (jobId: string) => Promise<void>
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
  queue: [],
  testResults: {},
  testRunning: {},
  claudeAvailable: false,
  ghAvailable: false,
  agentAuth: {
    'claude-code': { agentType: 'claude-code', installed: false, loggedIn: false },
    codex: { agentType: 'codex', installed: false, loggedIn: false },
    cursor: { agentType: 'cursor', installed: false, loggedIn: false }
  },
  agentCredentials: {
    'claude-code': { agentType: 'claude-code', configured: false, kind: null, updatedAt: null },
    codex: { agentType: 'codex', configured: false, kind: null, updatedAt: null },
    cursor: { agentType: 'cursor', configured: false, kind: null, updatedAt: null }
  },

  loading: false,
  error: null,
  _initialized: false,

  init: async () => {
    if (get()._initialized) return
    set({ _initialized: true })

    // Subscribe to push events exactly once.
    ipc.onWorkspaceEvent((evt) => get()._handlePush(evt))

    try {
      const [repos, claudeAvailable, ghAvailable] = await Promise.all([
        ipc.listRepos(),
        ipc.isAgentAvailable('claude-code'),
        ipc.isGhAvailable()
      ])
      set({ repos, claudeAvailable, ghAvailable })
      const first = repos[0]
      if (first) await get().selectRepo(first.path)
    } catch (err) {
      set({ error: errMessage(err) })
    }
    // Auth status is non-blocking and best-effort; never fail init over it.
    void get().refreshAgentAuth()
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
      const sel = get().selectedWorkspaceId
      const selectedWorkspaceId = workspaces.some((w) => w.id === sel)
        ? sel
        : (workspaces[0]?.id ?? null)
      set({ workspaces, selectedWorkspaceId })
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

  fanOut: async (name, baseBranch, prompt, variants) => {
    const repoPath = get().activeRepoPath
    if (!repoPath) return
    set({ loading: true, error: null })
    try {
      const created = await ipc.fanOut({ repoPath, name, baseBranch, prompt, variants })
      // Seed each variant's transcript with the shared prompt, then refresh so
      // the new grouped workspaces appear; select the first variant.
      set((s) => {
        const chats = { ...s.chats }
        for (const ws of created) {
          chats[ws.id] = [
            { id: nextId(), at: new Date().toISOString(), source: 'user', text: prompt }
          ]
        }
        return { chats }
      })
      await get().refreshWorkspaces()
      const first = created[0]
      if (first) set({ selectedWorkspaceId: first.id })
    } catch (err) {
      set({ error: errMessage(err) })
    } finally {
      set({ loading: false })
    }
  },

  archiveSiblings: async (workspaceId) => {
    set({ loading: true, error: null })
    try {
      await ipc.archiveSiblings(workspaceId)
      await get().refreshWorkspaces()
    } catch (err) {
      set({ error: errMessage(err) })
    } finally {
      set({ loading: false })
    }
  },

  setTestCommand: async (repoPath, testCommand) => {
    try {
      await ipc.setTestCommand(repoPath, testCommand)
      // Reflect the change without a full reload.
      const repoInfo = await ipc.getRepoInfo(repoPath)
      set((s) => ({
        repoInfo: s.activeRepoPath === repoPath ? repoInfo : s.repoInfo,
        repos: s.repos.map((r) => (r.path === repoPath ? { ...r, testCommand: repoInfo.testCommand } : r))
      }))
    } catch (err) {
      set({ error: errMessage(err) })
    }
  },

  runTests: async (workspaceId) => {
    set((s) => ({ testRunning: { ...s.testRunning, [workspaceId]: true } }))
    try {
      const result = await ipc.runTests(workspaceId)
      set((s) => ({ testResults: { ...s.testResults, [workspaceId]: result } }))
    } catch (err) {
      set({ error: errMessage(err) })
    } finally {
      set((s) => ({ testRunning: { ...s.testRunning, [workspaceId]: false } }))
    }
  },

  runTestsForGroup: async (workspaceIds) => {
    await Promise.all(workspaceIds.map((id) => get().runTests(id)))
  },

  refreshAgentAuth: async () => {
    try {
      const [claude, codex, claudeCred, codexCred] = await Promise.all([
        ipc.getAgentAuthStatus('claude-code'),
        ipc.getAgentAuthStatus('codex'),
        ipc.getCredentialInfo('claude-code'),
        ipc.getCredentialInfo('codex')
      ])
      set((s) => ({
        agentAuth: { ...s.agentAuth, 'claude-code': claude, codex },
        agentCredentials: { ...s.agentCredentials, 'claude-code': claudeCred, codex: codexCred },
        claudeAvailable: claude.installed
      }))
    } catch (err) {
      set({ error: errMessage(err) })
    }
  },

  setCredential: async (agentType, kind, secret) => {
    try {
      const info = await ipc.setCredential(agentType, kind, secret)
      set((s) => ({ agentCredentials: { ...s.agentCredentials, [agentType]: info } }))
    } catch (err) {
      set({ error: errMessage(err) })
    }
  },

  clearCredential: async (agentType) => {
    try {
      const info = await ipc.clearCredential(agentType)
      set((s) => ({ agentCredentials: { ...s.agentCredentials, [agentType]: info } }))
    } catch (err) {
      set({ error: errMessage(err) })
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

  enqueueJob: async (workspaceId, prompt, dependsOnWorkspaceId) => {
    // Show the queued prompt in the transcript so the user sees what they lined up.
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
      await ipc.enqueueJob({ workspaceId, prompt, dependsOnWorkspaceId })
    } catch (err) {
      set({ error: errMessage(err) })
    }
  },

  cancelJob: async (jobId) => {
    try {
      await ipc.cancelJob(jobId)
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
    if (evt.type === 'queue_changed') {
      set({ queue: evt.jobs })
      return
    }
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
