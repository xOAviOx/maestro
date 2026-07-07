import { useEffect, useMemo, useState } from 'react'
import type { UsageEvent, Workspace } from '@shared/types'
import { burnRateTokensPerMin, rollup, sessionEvents } from '@shared/usage'
import { useStore } from '../../store'
import { ipc } from '../../ipc'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { CostTiles } from './CostTiles'
import { CostOverTimeChart } from './CostOverTimeChart'
import { AgentUsageTable } from './AgentUsageTable'
import { WorkflowRollup } from './WorkflowRollup'
import { HistoryView } from './HistoryView'

/**
 * Live snapshot of the store's usage working set plus a wall clock, refreshed on
 * a 1s cadence. Reading via getState() (rather than a reactive selector) is what
 * throttles the dashboard to ≤1 update/sec no matter how fast `usage_recorded`
 * pushes arrive; `now` advancing every tick keeps burn rate and running-agent
 * durations live even when no new events land.
 */
function useThrottledUsage(): { events: UsageEvent[]; now: number } {
  const [snap, setSnap] = useState(() => ({
    events: useStore.getState().usageEvents,
    now: Date.now()
  }))
  useEffect(() => {
    const iv = setInterval(
      () => setSnap({ events: useStore.getState().usageEvents, now: Date.now() }),
      1000
    )
    return () => clearInterval(iv)
  }, [])
  return snap
}

/**
 * Main panel for the cost/usage dashboard (Phase 2.2): live tiles, a cumulative
 * cost chart, a sortable per-agent table, a per-workflow rollup, and history.
 * All aggregation reads a throttled snapshot; cost math comes from the shared,
 * unit-tested helpers so numbers reconcile across every view.
 */
export function DashboardView(): JSX.Element {
  const { events, now } = useThrottledUsage()
  const pricing = useStore((s) => s.pricing)
  const sessionStartedAt = useStore((s) => s.sessionStartedAt)
  const workflows = useStore((s) => s.workflows)
  const liveWorkspaces = useStore((s) => s.workspaces)
  const refreshUsage = useStore((s) => s.refreshUsage)
  const setActiveDialog = useStore((s) => s.setActiveDialog)

  // Names/models for agents across every repo (usage can outlive the active
  // repo's workspace list). Fetched once; live statuses are overlaid from the
  // store below so running agents still read as running.
  const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([])
  useEffect(() => {
    void ipc
      .listAllWorkspaces()
      .then(setAllWorkspaces)
      .catch(() => setAllWorkspaces([]))
  }, [])

  const workspaceMap = useMemo(() => {
    const map = new Map<string, Workspace>()
    for (const w of allWorkspaces) map.set(w.id, w)
    for (const w of liveWorkspaces) map.set(w.id, w) // live status wins
    return map
  }, [allWorkspaces, liveWorkspaces])

  const session = useMemo(
    () => sessionEvents(events, sessionStartedAt),
    [events, sessionStartedAt]
  )
  const sessionRollup = useMemo(() => rollup(session, pricing), [session, pricing])
  const burn = useMemo(() => burnRateTokensPerMin(events, now), [events, now])
  const activeAgents = useMemo(
    () => [...workspaceMap.values()].filter((w) => w.status === 'running').length,
    [workspaceMap]
  )

  const hasWorkflowUsage = workflows.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-hair px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-content">Cost &amp; Usage</h2>
          <p className="truncate text-xs text-content-faint">
            {pricing
              ? `Rates verified ${pricing.lastVerified} · this session since ${
                  sessionStartedAt
                    ? new Date(sessionStartedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })
                    : '—'
                }`
              : 'Loading pricing…'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setActiveDialog('settings')}>
            <Icon name="settings" size={14} />
            Rates
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void refreshUsage()}>
            <Icon name="refresh" size={14} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <CostTiles session={sessionRollup} burnRateTokensPerMin={burn} activeAgents={activeAgents} />

        <CostOverTimeChart events={session} workspaces={workspaceMap} pricing={pricing} />

        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-content-faint">
            Per agent · this session
          </h3>
          <AgentUsageTable events={session} workspaces={workspaceMap} pricing={pricing} now={now} />
        </section>

        {hasWorkflowUsage && (
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-content-faint">
              Per workflow
            </h3>
            <WorkflowRollup events={events} workflows={workflows} pricing={pricing} />
          </section>
        )}

        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-content-faint">
            History · all sessions
          </h3>
          <HistoryView events={events} pricing={pricing} />
        </section>
      </div>
    </div>
  )
}
