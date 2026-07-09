/**
 * Scene drivers. Each scene puts the live app into one feature's "working"
 * state, then resolves once the DOM has had a tick to render. The Playwright
 * driver awaits `window.__scenes[name]()`, waits for the scene's anchor
 * selector, and screenshots.
 *
 * Scenes drive the REAL Zustand store (view/tab/dialog/selection) and emit
 * synthetic push events through the mock bridge — the same path the live app
 * uses — so what we capture is the genuine UI, just fed deterministic data.
 */
import type { StoreApi, UseBoundStore } from 'zustand'
import type { AgentEvent } from '@shared/types'
import type { MockBridge } from './mock-maestro'
import * as fx from './fixtures'

// The store's public state is broad; we only touch a handful of fields/actions.
type AnyStore = UseBoundStore<StoreApi<Record<string, unknown>>>

interface Ctx {
  store: AnyStore
  bridge: MockBridge
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Push an agent_event into a workspace's transcript via the real event path. */
function agentEvent(bridge: MockBridge, workspaceId: string, event: AgentEvent): void {
  bridge.emitWorkspace({ type: 'agent_event', workspaceId, event })
}

/** Seed a rich chat transcript for the signup workspace (tool calls + text). */
function seedSignupChat(bridge: MockBridge): void {
  const id = fx.ids.wsSignup
  const events: AgentEvent[] = [
    { kind: 'session_started', sessionId: 'sess-signup' },
    { kind: 'assistant_text', text: "I'll add client-side validation and inline error states to the signup form." },
    { kind: 'tool_use', name: 'Read', input: { file_path: 'src/components/SignupForm.tsx' } },
    { kind: 'tool_result', name: 'Read', ok: true, summary: '38 lines' },
    { kind: 'tool_use', name: 'Edit', input: { file_path: 'src/components/SignupForm.tsx' } },
    { kind: 'tool_result', name: 'Edit', ok: true, summary: 'applied' },
    { kind: 'tool_use', name: 'Write', input: { file_path: 'src/lib/validation.ts' } },
    { kind: 'tool_result', name: 'Write', ok: true, summary: 'created' },
    {
      kind: 'assistant_text',
      text: 'Done. Email is validated against an RFC-ish pattern and the password requires 8+ characters, each with an inline error message under its field. I also added `aria-invalid` for accessibility.'
    },
    { kind: 'turn_complete', sessionId: 'sess-signup', usage: { totalCostUsd: 0.0231 } }
  ]
  // The user prompt is seeded separately by the scene; stream the agent events.
  for (const e of events) agentEvent(bridge, id, e)
}

export function registerScenes(ctx: Ctx): Record<string, () => Promise<void>> {
  const { store, bridge } = ctx
  const set = (partial: Record<string, unknown>): void => store.setState(partial)

  // Seed a user prompt into a transcript directly in the store.
  const seedUserPrompt = (workspaceId: string, text: string): void => {
    const s = store.getState() as { chats: Record<string, unknown[]> }
    const chats = { ...s.chats }
    chats[workspaceId] = [
      { id: `u-${workspaceId}`, at: fx.sessionStartedAt, source: 'user', text },
      ...(chats[workspaceId] ?? [])
    ]
    set({ chats })
  }

  const base = (): void => {
    set({
      repos: [fx.repoRecord],
      activeRepoPath: fx.repoRecord.path,
      repoInfo: fx.repoInfo,
      workspaces: fx.workspaces,
      workflows: fx.workflows,
      usageEvents: fx.usageEvents,
      pricing: fx.pricing,
      sessionStartedAt: fx.sessionStartedAt,
      agentAuth: fx.agentAuth,
      agentCredentials: fx.credentials,
      claudeAvailable: true,
      ghAvailable: true,
      loading: false,
      chats: {},
      queue: [],
      toasts: [],
      testResults: {},
      testRunning: {},
      pendingPermissions: {},
      activeDialog: null
    })
  }

  const scenes: Record<string, () => Promise<void>> = {
    async sidebar() {
      base()
      set({ view: 'workspaces', selectedWorkspaceId: fx.ids.wsSignup, activeTab: 'chat' })
      seedUserPrompt(fx.ids.wsSignup, 'Add input validation and an error state to the signup form')
      seedSignupChat(bridge)
      await wait(250)
    },

    async agentChat() {
      base()
      set({ view: 'workspaces', selectedWorkspaceId: fx.ids.wsSignup, activeTab: 'chat' })
      seedUserPrompt(fx.ids.wsSignup, 'Add input validation and an error state to the signup form')
      seedSignupChat(bridge)
      // Flip to awaiting_input so the header shows a settled turn.
      bridge.emitWorkspace({ type: 'status_changed', workspaceId: fx.ids.wsSignup, status: 'awaiting_input' })
      await wait(250)
    },

    async fanoutDialog() {
      base()
      set({ view: 'workspaces', selectedWorkspaceId: fx.ids.wsSignup, activeDialog: 'fanout' })
      await wait(250)
    },

    async comparison() {
      base()
      set({
        view: 'workspaces',
        selectedWorkspaceId: fx.ids.vB,
        activeTab: 'compare',
        testResults: { [fx.ids.vB]: fx.testResults[fx.ids.vB]!, [fx.ids.vC]: fx.testResults[fx.ids.vC]! }
      })
      // Seed short previews for each variant.
      seedUserPrompt(fx.ids.vA, 'Design an empty-state illustration for the todo list')
      seedUserPrompt(fx.ids.vB, 'Design an empty-state illustration for the todo list')
      seedUserPrompt(fx.ids.vC, 'Design an empty-state illustration for the todo list')
      agentEvent(bridge, fx.ids.vA, { kind: 'assistant_text', text: 'Added an inline SVG with a soft gradient and a “Create your first todo” CTA.' })
      agentEvent(bridge, fx.ids.vB, { kind: 'assistant_text', text: 'Built a reusable <EmptyState/> with an illustration slot, heading, and action button; wired it into App.' })
      agentEvent(bridge, fx.ids.vC, { kind: 'assistant_text', text: 'Sketched a minimal empty state — needs a test id before the suite passes.' })
      await wait(400)
    },

    async diff() {
      base()
      set({ view: 'workspaces', selectedWorkspaceId: fx.ids.wsSignup, activeTab: 'diff' })
      // Monaco needs a beat to spin up its worker + tokenize.
      await wait(2200)
    },

    async reviewBar() {
      base()
      set({ view: 'workspaces', selectedWorkspaceId: fx.ids.wsSignup, activeTab: 'chat' })
      seedUserPrompt(fx.ids.wsSignup, 'Add input validation and an error state to the signup form')
      seedSignupChat(bridge)
      await wait(300)
    },

    async queue() {
      base()
      set({ view: 'workspaces', selectedWorkspaceId: fx.ids.wsSignup, activeTab: 'chat' })
      seedUserPrompt(fx.ids.wsSignup, 'Add input validation and an error state to the signup form')
      seedSignupChat(bridge)
      bridge.emitWorkspace({ type: 'status_changed', workspaceId: fx.ids.wsSignup, status: 'running' })
      bridge.emitWorkspace({ type: 'queue_changed', jobs: fx.queue })
      await wait(300)
    },

    async permission() {
      base()
      set({ view: 'workspaces', selectedWorkspaceId: fx.ids.wsSignup, activeTab: 'chat' })
      seedUserPrompt(fx.ids.wsSignup, 'Add input validation and an error state to the signup form')
      seedSignupChat(bridge)
      bridge.emitWorkspace({ type: 'status_changed', workspaceId: fx.ids.wsSignup, status: 'running' })
      agentEvent(bridge, fx.ids.wsSignup, {
        kind: 'permission_request',
        requestId: 'perm-1',
        toolName: 'Bash',
        input: { command: 'npm install zod && npm run build' },
        title: 'Run a shell command',
        description: 'The agent wants to install a dependency and rebuild before continuing.'
      })
      await wait(300)
    },

    async terminal() {
      base()
      set({ view: 'workspaces', selectedWorkspaceId: fx.ids.vB, activeTab: 'terminal' })
      // startTerminal() already replays fx.terminalBuffer on attach; just wait
      // for xterm to open and paint.
      await wait(900)
    },

    async workflowGraph() {
      base()
      set({ view: 'workflows', selectedWorkflowId: fx.workflow.id })
      bridge.emitWorkflow({ type: 'workflow_updated', workflow: fx.workflow })
      // React Flow fitView needs a beat after layout.
      await wait(900)
    },

    async workflowInspector() {
      base()
      set({ view: 'workflows', selectedWorkflowId: fx.workflow.id })
      bridge.emitWorkflow({ type: 'workflow_updated', workflow: fx.workflow })
      await wait(900)
      // Select the completed task so its inspector (with approve/reject) shows.
      const node = document.querySelector<HTMLElement>('[data-id="refactor-b"]')
      node?.click()
      await wait(400)
    },

    async workflowBuilder() {
      base()
      set({ view: 'workflows', selectedWorkflowId: fx.workflow.id, activeDialog: 'workflow-builder' })
      await wait(700)
    },

    async dashboard() {
      base()
      set({ view: 'dashboard', selectedWorkspaceId: fx.ids.wsSignup })
      // Recharts animates in; give it a moment.
      await wait(900)
    },

    async settings() {
      base()
      set({ view: 'workspaces', selectedWorkspaceId: fx.ids.wsSignup, activeDialog: 'settings' })
      await wait(400)
    }
  }

  return scenes
}
