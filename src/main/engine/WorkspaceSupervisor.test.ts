import { describe, it, expect, vi } from 'vitest'
import { WorkspaceSupervisor, requiresApproval } from './WorkspaceSupervisor'
import type { Engine } from './index'
import type { Harness, LaunchOptions } from '../harness'
import type { AgentEvent, WorkspacePushEvent } from '@shared/types'

// --- gating policy ----------------------------------------------------------

describe('requiresApproval', () => {
  it('gates writes and shell tools (case-insensitive)', () => {
    for (const t of ['Bash', 'PowerShell', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'write', 'BASH']) {
      expect(requiresApproval(t)).toBe(true)
    }
  })

  it('lets read-only / non-mutating tools through', () => {
    for (const t of ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite']) {
      expect(requiresApproval(t)).toBe(false)
    }
  })
})

// --- approval plumbing ------------------------------------------------------

const WS_ID = 'ws-1'

/** Minimal engine stub exposing only what a run touches. */
function fakeEngine(): Engine {
  return {
    worktrees: {
      getWorkspace: vi.fn(async () => ({
        id: WS_ID,
        agentType: 'claude-code',
        worktreePath: '/tmp/wt',
        sessionId: null
      }))
    },
    workspaces: {
      setStatus: vi.fn(),
      setSessionId: vi.fn(),
      getById: vi.fn(() => undefined)
    },
    credentials: { reveal: vi.fn(() => null) },
    usageEvents: { record: vi.fn() }
  } as unknown as Engine
}

/**
 * A harness that requests permission for one non-gated then one gated tool,
 * exposing hooks so the test can drive the timing.
 */
function fakeHarness(record: { decisions: Array<[string, string]> }): {
  harness: Harness
  gatedRequested: Promise<void>
} {
  let signalGated: () => void = () => {}
  const gatedRequested = new Promise<void>((r) => (signalGated = r))

  const harness: Harness = {
    type: 'claude-code',
    isAvailable: async () => true,
    cancel: vi.fn(),
    run: async (opts: LaunchOptions, onEvent: (e: AgentEvent) => void) => {
      onEvent({ kind: 'session_started', sessionId: 's1' })
      const req = opts.requestPermission!
      // Non-gated tool: should resolve immediately without user input.
      const read = await req({ toolName: 'Read', input: {} })
      record.decisions.push(['Read', read.behavior])
      // Gated tool: pauses until the supervisor resolves it.
      const writeP = req({ toolName: 'Write', input: { file_path: 'a.txt' } })
      signalGated()
      const write = await writeP
      record.decisions.push(['Write', write.behavior])
      onEvent({ kind: 'turn_complete', sessionId: 's1' })
      return { sessionId: 's1' }
    }
  }
  return { harness, gatedRequested }
}

/** Resolves with the first permission_request event the supervisor emits. */
function firstPermissionRequest(sup: WorkspaceSupervisor): Promise<{ requestId: string }> {
  return new Promise((resolve) => {
    const unsub = sup.subscribe((evt: WorkspacePushEvent) => {
      if (evt.type === 'agent_event' && evt.event.kind === 'permission_request') {
        unsub()
        resolve({ requestId: evt.event.requestId })
      }
    })
  })
}

function runFinished(sup: WorkspaceSupervisor): Promise<void> {
  return new Promise((resolve) => {
    const unsub = sup.subscribe((evt: WorkspacePushEvent) => {
      if (evt.type === 'status_changed' && evt.status !== 'running') {
        unsub()
        resolve()
      }
    })
  })
}

describe('WorkspaceSupervisor approval gate', () => {
  it('auto-allows reads and blocks on gated tools until approved', async () => {
    const record = { decisions: [] as Array<[string, string]> }
    const { harness } = fakeHarness(record)
    const sup = new WorkspaceSupervisor(fakeEngine(), undefined, () => harness)

    const gotRequest = firstPermissionRequest(sup)
    const done = runFinished(sup)
    await sup.startRun(WS_ID, 'do it', undefined, /* gate */ true)

    const { requestId } = await gotRequest
    sup.resolvePermission(WS_ID, requestId, 'approve')
    await done

    expect(record.decisions).toEqual([
      ['Read', 'allow'], // non-gated, resolved without any user prompt
      ['Write', 'allow'] // gated, resolved by the approve
    ])
  })

  it('denies the gated tool when the user rejects', async () => {
    const record = { decisions: [] as Array<[string, string]> }
    const { harness } = fakeHarness(record)
    const sup = new WorkspaceSupervisor(fakeEngine(), undefined, () => harness)

    const gotRequest = firstPermissionRequest(sup)
    const done = runFinished(sup)
    await sup.startRun(WS_ID, 'do it', undefined, true)

    const { requestId } = await gotRequest
    sup.resolvePermission(WS_ID, requestId, 'reject')
    await done

    expect(record.decisions).toContainEqual(['Write', 'deny'])
  })

  it('does not gate when gateApprovals is false (autonomous run)', async () => {
    // A harness that would throw if asked to request permission — proving the
    // supervisor passes no callback for autonomous runs.
    const harness: Harness = {
      type: 'claude-code',
      isAvailable: async () => true,
      cancel: vi.fn(),
      run: async (opts, onEvent) => {
        expect(opts.requestPermission).toBeUndefined()
        onEvent({ kind: 'turn_complete', sessionId: 's1' })
        return { sessionId: 's1' }
      }
    }
    const sup = new WorkspaceSupervisor(fakeEngine(), undefined, () => harness)
    const done = runFinished(sup)
    await sup.startRun(WS_ID, 'auto', undefined /* gate defaults false */)
    await done
  })
})
