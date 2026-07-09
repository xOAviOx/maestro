/**
 * Mock `window.maestro` for the screenshot harness. Implements the full
 * `MaestroApi` surface, returning seeded fixtures and remembering the renderer's
 * push-event + terminal listeners so scenes can drive live-looking updates
 * (streaming chat, status flips, usage ticks, terminal output).
 *
 * It is deliberately permissive: mutating calls (merge, approve, reject, …) just
 * resolve with a believable value — the harness never needs real side effects.
 */
import type { MaestroApi } from '@shared/ipc'
import type {
  AgentType,
  TerminalDataEvent,
  TerminalExitEvent,
  WorkflowPushEvent,
  WorkspacePushEvent
} from '@shared/types'
import * as fx from './fixtures'

export interface MockBridge {
  emitWorkspace(evt: WorkspacePushEvent): void
  emitWorkflow(evt: WorkflowPushEvent): void
  emitTerminalData(evt: TerminalDataEvent): void
  emitTerminalExit(evt: TerminalExitEvent): void
}

export function installMockMaestro(): MockBridge {
  const wsListeners = new Set<(e: WorkspacePushEvent) => void>()
  const wfListeners = new Set<(e: WorkflowPushEvent) => void>()
  const termDataListeners = new Set<(e: TerminalDataEvent) => void>()
  const termExitListeners = new Set<(e: TerminalExitEvent) => void>()

  const versions = { electron: '33.3.1', chrome: '130.0', node: '20.18.1' }

  const api: MaestroApi = {
    ping: async (message) => ({ reply: `pong: ${message}`, at: fx.sessionStartedAt, versions }),
    openDirectoryDialog: async () => null,
    openExternal: async () => {},

    // repos
    registerRepo: async () => fx.repoInfo,
    listRepos: async () => [fx.repoRecord],
    getRepoInfo: async () => fx.repoInfo,
    setFilesToCopy: async () => {},
    setTestCommand: async () => {},

    // workspaces
    createWorkspace: async (input) => ({
      ...fx.workspaces[0]!,
      name: input.name,
      status: 'idle'
    }),
    fanOut: async () => fx.workspaces.filter((w) => w.groupId === fx.GROUP_ID),
    listWorkspaces: async () => fx.workspaces,
    listAllWorkspaces: async () => fx.workspaces,
    getWorkspace: async (id) => fx.workspaces.find((w) => w.id === id) ?? fx.workspaces[0]!,
    getDiff: async (id) =>
      fx.diffByWorkspace[id] ?? { baseBranch: 'main', mergeBase: 'abc1234', files: [], patch: '', untracked: [] },
    getFileDiff: async (_id, path) => fx.fileDiffFor(path),
    getReviewStatus: async (id) => fx.reviewStatusFor(id),
    listReviewHistory: async (id) => fx.reviewHistoryByWorkspace[id] ?? [],
    commitWorkspace: async () => true,
    mergeWorkspace: async (_id, _opts) => ({
      merged: true,
      committed: true,
      baseBranch: 'main',
      branch: 'maestro/signup-validation'
    }),
    createPullRequest: async () => ({ url: 'https://github.com/you/todo-app/pull/43', committed: true }),
    archiveWorkspace: async () => {},
    archiveSiblings: async () => {},
    runTests: async (id) => fx.testResults[id] ?? fx.testResults[fx.ids.vB]!,

    // agents
    startAgent: async () => {},
    cancelAgent: async () => {},
    respondToAgentPermission: async () => {},
    enqueueJob: async (input) => ({
      id: 'job-new',
      workspaceId: input.workspaceId,
      prompt: input.prompt,
      dependsOnWorkspaceId: input.dependsOnWorkspaceId ?? null,
      createdAt: fx.sessionStartedAt
    }),
    listQueue: async () => fx.queue,
    cancelJob: async () => {},
    isAgentAvailable: async () => true,
    getAgentAuthStatus: async (agentType: AgentType) => fx.agentAuth[agentType]!,
    startAgentLogin: async () => ({ sessionKey: 'login-session' }),
    getCredentialInfo: async (agentType: AgentType) => fx.credentials[agentType]!,
    setCredential: async (agentType, kind) => ({
      agentType,
      configured: true,
      kind,
      updatedAt: fx.sessionStartedAt
    }),
    clearCredential: async (agentType) => ({ agentType, configured: false, kind: null, updatedAt: null }),

    // workflows
    createWorkflow: async () => fx.workflow,
    listWorkflows: async () => fx.workflows,
    getWorkflow: async (id) => fx.workflows.find((w) => w.id === id) ?? fx.workflow,
    startWorkflow: async (id) => fx.workflows.find((w) => w.id === id) ?? fx.workflow,
    pauseWorkflow: async (id) => fx.workflows.find((w) => w.id === id) ?? fx.workflow,
    resumeWorkflow: async (id) => fx.workflows.find((w) => w.id === id) ?? fx.workflow,
    approveTask: async (id) => fx.workflows.find((w) => w.id === id) ?? fx.workflow,
    rejectTask: async (id) => fx.workflows.find((w) => w.id === id) ?? fx.workflow,
    retryTask: async (id) => fx.workflows.find((w) => w.id === id) ?? fx.workflow,
    previewCascade: async () => ['tests', 'docs'],
    onWorkflowEvent: (listener) => {
      wfListeners.add(listener)
      return () => wfListeners.delete(listener)
    },

    // usage & cost
    listUsage: async () => fx.usageEvents,
    getUsageSummary: async () => ({
      eventCount: fx.usageEvents.length,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalCostUsd: 0,
      costComplete: true
    }),
    getSessionStart: async () => fx.sessionStartedAt,
    getPricing: async () => fx.pricing,
    setPricing: async (table) => table,

    // integrations
    isGhAvailable: async () => true,

    // terminal
    startTerminal: async () => ({ buffer: fx.terminalBuffer }),
    sendTerminalInput: () => {},
    resizeTerminal: () => {},
    disposeTerminal: async () => {},
    onTerminalData: (listener) => {
      termDataListeners.add(listener)
      return () => termDataListeners.delete(listener)
    },
    onTerminalExit: (listener) => {
      termExitListeners.add(listener)
      return () => termExitListeners.delete(listener)
    },

    // push subscription
    onWorkspaceEvent: (listener) => {
      wsListeners.add(listener)
      return () => wsListeners.delete(listener)
    }
  }

  ;(window as unknown as { maestro: MaestroApi }).maestro = api

  return {
    emitWorkspace: (evt) => wsListeners.forEach((l) => l(evt)),
    emitWorkflow: (evt) => wfListeners.forEach((l) => l(evt)),
    emitTerminalData: (evt) => termDataListeners.forEach((l) => l(evt)),
    emitTerminalExit: (evt) => termExitListeners.forEach((l) => l(evt))
  }
}
