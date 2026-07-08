import { create } from 'zustand'
import { ipc, MaestroClientError } from './ipc'
import type {
  AgentAuthStatus,
  AgentEvent,
  AgentType,
  CreateWorkflowInput,
  CredentialInfo,
  CredentialKind,
  FanOutVariant,
  PricingTable,
  QueuedJob,
  RepoInfo,
  RepoRecord,
  TestResult,
  UsageEvent,
  Workflow,
  WorkflowPushEvent,
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

/** A transient notification shown bottom-right (success/error/info). */
export type Toast = {
  id: string
  kind: 'success' | 'error' | 'info'
  message: string
}

/** Tabs in the main workspace panel. Kept in the store so shortcuts can switch. */
export type WorkspaceTab = 'chat' | 'diff' | 'terminal' | 'compare'

/** Which global dialog (if any) is open. Lifted here so shortcuts can open them. */
export type ActiveDialog =
  | 'new'
  | 'fanout'
  | 'settings'
  | 'shortcuts'
  | 'workflow-builder'
  | null

/**
 * The active top-level view. Workspaces is the original single-agent workbench;
 * workflows is the DAG scheduler view (Module 12/Phase 1.3). Kept in the store
 * so the sidebar toggle and the main panel stay in sync.
 */
export type MainView = 'workspaces' | 'workflows' | 'dashboard'

/** Most recent usage events kept in the renderer for the dashboard. Persisted
 * history lives in main (SQLite); this cap bounds the live working set. */
const USAGE_EVENT_CAP = 5000

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
  /** Outcome of each tool-approval prompt, keyed by requestId. Absent =
   * still pending (buttons live); present = settled (buttons frozen). */
  permissionResolutions: Record<string, 'approved' | 'rejected' | 'expired'>
  /** Pending queued jobs across all workspaces (renderer filters by workspace). */
  queue: QueuedJob[]
  /** Latest test result per workspace id (session-only, like chats). */
  testResults: Record<string, TestResult>
  /** Per-workspace "tests running" flag, so variants can run independently. */
  testRunning: Record<string, boolean>
  /** Workspaces whose base branch advanced while their agent runs (badge count =
   * commits base is ahead). Set by `base_advanced` pushes; cleared on any status
   * change (the worktree is rebased when the agent completes). */
  baseAdvanced: Record<string, number>
  claudeAvailable: boolean
  ghAvailable: boolean
  /** Per-agent install + login state, shown in the Accounts settings panel. */
  agentAuth: Record<AgentType, AgentAuthStatus>
  /** Per-agent stored-credential metadata (Advanced headless fallback). */
  agentCredentials: Record<AgentType, CredentialInfo>
  /** All DAG workflows (across repos; the view filters to the active repo). */
  workflows: Workflow[]
  /** The workflow shown in the graph view, or null for the empty state. */
  selectedWorkflowId: string | null
  /** Usage samples for the dashboard (newest first), seeded from persisted
   * history and appended live from `usage_recorded` pushes. */
  usageEvents: UsageEvent[]
  /** Active model pricing (override or defaults) for per-event cost math. Null
   * until loaded; the dashboard flags costs as unavailable meanwhile. */
  pricing: PricingTable | null
  /** ISO time main started this session — the boundary "this session" tiles use. */
  sessionStartedAt: string | null

  // ui
  loading: boolean
  error: string | null
  /** Transient notifications (newest last). Rendered by ToastViewport. */
  toasts: Toast[]
  /** The active top-level view (workspaces vs. the DAG workflows view). */
  view: MainView
  /** The active tab in the workspace panel (so shortcuts can switch it). */
  activeTab: WorkspaceTab
  /** Which global dialog is open (so shortcuts can open them). */
  activeDialog: ActiveDialog

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
  respondPermission: (workspaceId: string, requestId: string, approve: boolean) => Promise<void>
  archiveWorkspace: (id: string) => Promise<void>
  clearError: () => void
  pushToast: (kind: Toast['kind'], message: string) => void
  dismissToast: (id: string) => void
  setView: (view: MainView) => void
  setActiveTab: (tab: WorkspaceTab) => void
  setActiveDialog: (dialog: ActiveDialog) => void
  // workflows (DAG scheduler — Phase 1.3)
  refreshWorkflows: () => Promise<void>
  selectWorkflow: (id: string | null) => void
  createWorkflow: (input: CreateWorkflowInput) => Promise<Workflow | null>
  startWorkflow: (id: string) => Promise<void>
  pauseWorkflow: (id: string) => Promise<void>
  resumeWorkflow: (id: string) => Promise<void>
  approveTask: (workflowId: string, taskId: string) => Promise<void>
  rejectTask: (
    workflowId: string,
    taskId: string,
    mode: 'cascade' | 'retry',
    prompt?: string
  ) => Promise<void>
  retryTask: (workflowId: string, taskId: string) => Promise<void>
  // usage & cost dashboard (Phase 2.2)
  refreshUsage: () => Promise<void>
  savePricing: (table: PricingTable) => Promise<void>
  _handlePush: (evt: WorkspacePushEvent) => void
  _handleWorkflowPush: (evt: WorkflowPushEvent) => void
}

export const useStore = create<MaestroState>((set, get) => ({
  repos: [],
  activeRepoPath: null,
  repoInfo: null,
  workspaces: [],
  selectedWorkspaceId: null,
  chats: {},
  permissionResolutions: {},
  queue: [],
  testResults: {},
  testRunning: {},
  baseAdvanced: {},
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
  workflows: [],
  selectedWorkflowId: null,
  usageEvents: [],
  pricing: null,
  sessionStartedAt: null,

  loading: false,
  error: null,
  toasts: [],
  view: 'workspaces',
  activeTab: 'chat',
  activeDialog: null,
  _initialized: false,

  init: async () => {
    if (get()._initialized) return
    set({ _initialized: true })

    // Subscribe to push events exactly once.
    ipc.onWorkspaceEvent((evt) => get()._handlePush(evt))
    ipc.onWorkflowEvent((evt) => get()._handleWorkflowPush(evt))

    try {
      const [repos, claudeAvailable, ghAvailable] = await Promise.all([
        ipc.listRepos(),
        ipc.isAgentAvailable('claude-code'),
        ipc.isGhAvailable()
      ])
      set({ repos, claudeAvailable, ghAvailable })
      const first = repos[0]
      if (first) await get().selectRepo(first.path)
      // Workflows span repos and drive their own worktrees; load once up front.
      await get().refreshWorkflows()
    } catch (err) {
      get().pushToast('error', errMessage(err))
    }
    // Dashboard data (session boundary, pricing, usage history) is best-effort;
    // never fail init over it.
    void (async () => {
      try {
        const [sessionStartedAt, pricing] = await Promise.all([
          ipc.getSessionStart(),
          ipc.getPricing()
        ])
        set({ sessionStartedAt, pricing })
      } catch (err) {
        get().pushToast('error', errMessage(err))
      }
      await get().refreshUsage()
    })()
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
      get().pushToast('error', errMessage(err))
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
      get().pushToast('error', errMessage(err))
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
      get().pushToast('error', errMessage(err))
    }
  },

  createWorkspace: async (name, baseBranch, agentType) => {
    const repoPath = get().activeRepoPath
    if (!repoPath) return
    set({ loading: true, error: null })
    try {
      const ws = await ipc.createWorkspace({ repoPath, name, baseBranch, agentType })
      set((s) => ({ workspaces: [ws, ...s.workspaces], selectedWorkspaceId: ws.id }))
      get().pushToast('success', `Workspace “${ws.name}” created.`)
    } catch (err) {
      get().pushToast('error', errMessage(err))
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
      get().pushToast('success', `Launched ${created.length} variants for “${name}”.`)
    } catch (err) {
      get().pushToast('error', errMessage(err))
    } finally {
      set({ loading: false })
    }
  },

  archiveSiblings: async (workspaceId) => {
    set({ loading: true, error: null })
    try {
      await ipc.archiveSiblings(workspaceId)
      await get().refreshWorkspaces()
      get().pushToast('success', 'Kept this variant; archived the others.')
    } catch (err) {
      get().pushToast('error', errMessage(err))
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
      get().pushToast('success', 'Test command saved.')
    } catch (err) {
      get().pushToast('error', errMessage(err))
    }
  },

  runTests: async (workspaceId) => {
    set((s) => ({ testRunning: { ...s.testRunning, [workspaceId]: true } }))
    try {
      const result = await ipc.runTests(workspaceId)
      set((s) => ({ testResults: { ...s.testResults, [workspaceId]: result } }))
    } catch (err) {
      get().pushToast('error', errMessage(err))
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
      get().pushToast('error', errMessage(err))
    }
  },

  setCredential: async (agentType, kind, secret) => {
    try {
      const info = await ipc.setCredential(agentType, kind, secret)
      set((s) => ({ agentCredentials: { ...s.agentCredentials, [agentType]: info } }))
      get().pushToast('success', 'Credential saved.')
    } catch (err) {
      get().pushToast('error', errMessage(err))
    }
  },

  clearCredential: async (agentType) => {
    try {
      const info = await ipc.clearCredential(agentType)
      set((s) => ({ agentCredentials: { ...s.agentCredentials, [agentType]: info } }))
      get().pushToast('success', 'Credential removed.')
    } catch (err) {
      get().pushToast('error', errMessage(err))
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
      get().pushToast('error', errMessage(err))
    }
  },

  cancelAgent: async (workspaceId) => {
    try {
      await ipc.cancelAgent(workspaceId)
    } catch (err) {
      get().pushToast('error', errMessage(err))
    }
  },

  respondPermission: async (workspaceId, requestId, approve) => {
    // Optimistically freeze the buttons; main also broadcasts a
    // `permission_resolved` that settles it authoritatively.
    set((s) => ({
      permissionResolutions: {
        ...s.permissionResolutions,
        [requestId]: approve ? 'approved' : 'rejected'
      }
    }))
    try {
      await ipc.respondPermission(workspaceId, requestId, approve ? 'approve' : 'reject')
    } catch (err) {
      get().pushToast('error', errMessage(err))
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
      await ipc.enqueueJob({ workspaceId, prompt, dependsOnWorkspaceId, gateApprovals: true })
    } catch (err) {
      get().pushToast('error', errMessage(err))
    }
  },

  cancelJob: async (jobId) => {
    try {
      await ipc.cancelJob(jobId)
    } catch (err) {
      get().pushToast('error', errMessage(err))
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
      get().pushToast('success', 'Workspace archived.')
    } catch (err) {
      get().pushToast('error', errMessage(err))
    } finally {
      set({ loading: false })
    }
  },

  clearError: () => set({ error: null }),

  pushToast: (kind, message) =>
    set((s) => ({ toasts: [...s.toasts, { id: nextId(), kind, message }] })),

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setView: (view) => set({ view }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setActiveDialog: (dialog) => set({ activeDialog: dialog }),

  // --- workflows (DAG scheduler — Phase 1.3) --------------------------------

  refreshWorkflows: async () => {
    try {
      const workflows = await ipc.listWorkflows()
      set((s) => {
        // Keep the current selection if it still exists; else pick the first.
        const stillThere = workflows.some((w) => w.id === s.selectedWorkflowId)
        return {
          workflows,
          selectedWorkflowId: stillThere ? s.selectedWorkflowId : (workflows[0]?.id ?? null)
        }
      })
    } catch (err) {
      get().pushToast('error', errMessage(err))
    }
  },

  selectWorkflow: (id) => set({ selectedWorkflowId: id }),

  createWorkflow: async (input) => {
    set({ loading: true, error: null })
    try {
      const wf = await ipc.createWorkflow(input)
      // Push events only fire once a workflow is *running*; a fresh draft won't
      // arrive that way, so splice it in and select it directly.
      set((s) => ({
        workflows: [wf, ...s.workflows.filter((w) => w.id !== wf.id)],
        selectedWorkflowId: wf.id,
        view: 'workflows'
      }))
      get().pushToast('success', `Workflow “${wf.name}” created.`)
      return wf
    } catch (err) {
      get().pushToast('error', errMessage(err))
      return null
    } finally {
      set({ loading: false })
    }
  },

  startWorkflow: async (id) => {
    try {
      const wf = await ipc.startWorkflow(id)
      get()._handleWorkflowPush({ type: 'workflow_updated', workflow: wf })
    } catch (err) {
      get().pushToast('error', errMessage(err))
    }
  },

  pauseWorkflow: async (id) => {
    try {
      const wf = await ipc.pauseWorkflow(id)
      get()._handleWorkflowPush({ type: 'workflow_updated', workflow: wf })
    } catch (err) {
      get().pushToast('error', errMessage(err))
    }
  },

  resumeWorkflow: async (id) => {
    try {
      const wf = await ipc.resumeWorkflow(id)
      get()._handleWorkflowPush({ type: 'workflow_updated', workflow: wf })
    } catch (err) {
      get().pushToast('error', errMessage(err))
    }
  },

  approveTask: async (workflowId, taskId) => {
    try {
      const wf = await ipc.approveTask(workflowId, taskId)
      get()._handleWorkflowPush({ type: 'workflow_updated', workflow: wf })
    } catch (err) {
      // A merge/rebase conflict is an expected outcome, not a crash — the task's
      // conflict sub-state (pushed separately) explains it in the UI.
      get().pushToast('error', errMessage(err))
    }
  },

  rejectTask: async (workflowId, taskId, mode, prompt) => {
    try {
      const wf = await ipc.rejectTask(workflowId, taskId, mode, prompt)
      get()._handleWorkflowPush({ type: 'workflow_updated', workflow: wf })
    } catch (err) {
      get().pushToast('error', errMessage(err))
    }
  },

  retryTask: async (workflowId, taskId) => {
    try {
      const wf = await ipc.retryTask(workflowId, taskId)
      get()._handleWorkflowPush({ type: 'workflow_updated', workflow: wf })
    } catch (err) {
      get().pushToast('error', errMessage(err))
    }
  },

  // --- usage & cost dashboard (Phase 2.2) -----------------------------------

  refreshUsage: async () => {
    try {
      const usageEvents = await ipc.listUsage({ limit: USAGE_EVENT_CAP })
      set({ usageEvents })
    } catch (err) {
      get().pushToast('error', errMessage(err))
    }
  },

  savePricing: async (table) => {
    try {
      const pricing = await ipc.setPricing(table)
      set({ pricing })
      get().pushToast('success', 'Pricing rates saved.')
    } catch (err) {
      get().pushToast('error', errMessage(err))
    }
  },

  _handleWorkflowPush: (evt) => {
    set((s) => ({
      workflows: s.workflows.some((w) => w.id === evt.workflow.id)
        ? s.workflows.map((w) => (w.id === evt.workflow.id ? evt.workflow : w))
        : [evt.workflow, ...s.workflows]
    }))
  },

  _handlePush: (evt) => {
    if (evt.type === 'queue_changed') {
      set({ queue: evt.jobs })
      return
    }
    if (evt.type === 'status_changed') {
      set((s) => {
        // Any status change invalidates the stale-base badge: an agent leaving
        // `running` gets rebased on completion, so the count no longer applies.
        const { [evt.workspaceId]: _dropped, ...baseAdvanced } = s.baseAdvanced
        return {
          workspaces: s.workspaces.map((w) =>
            w.id === evt.workspaceId ? { ...w, status: evt.status } : w
          ),
          baseAdvanced
        }
      })
      return
    }
    if (evt.type === 'base_advanced') {
      set((s) => ({
        baseAdvanced: { ...s.baseAdvanced, [evt.workspaceId]: evt.baseAheadCount }
      }))
      return
    }
    if (evt.type === 'usage_recorded') {
      // Persisted in main; mirror it into the live working set (newest first,
      // bounded) so the dashboard updates without a re-fetch.
      set((s) => ({
        usageEvents: [evt.usage, ...s.usageEvents].slice(0, USAGE_EVENT_CAP)
      }))
      return
    }
    // A resolved approval settles an existing request bubble (freeze its
    // buttons) rather than adding a new line to the transcript.
    if (evt.event.kind === 'permission_resolved') {
      const { requestId, decision } = evt.event
      set((s) => ({
        permissionResolutions: { ...s.permissionResolutions, [requestId]: decision }
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
