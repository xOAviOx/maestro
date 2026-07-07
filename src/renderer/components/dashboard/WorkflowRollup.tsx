import { useMemo } from 'react'
import type { PricingTable, UsageEvent, Workflow } from '@shared/types'
import { formatRollupCost, formatTokens, rollup, type CostRollup } from '@shared/usage'

/**
 * Per-workflow cost rollup with a per-task breakdown (spec item 4). Usage events
 * are recorded per workspace and don't carry a workflow id, so we join through
 * the DAG: each task's `agentId` *is* its workspace id, so a task's cost is the
 * rollup of usage events for that workspace. Only workflows with recorded usage
 * are shown.
 */
export function WorkflowRollup({
  events,
  workflows,
  pricing
}: {
  events: UsageEvent[]
  workflows: Workflow[]
  pricing: PricingTable | null
}): JSX.Element | null {
  const byWorkspace = useMemo(() => {
    const map = new Map<string, UsageEvent[]>()
    for (const e of events) {
      const arr = map.get(e.workspaceId)
      if (arr) arr.push(e)
      else map.set(e.workspaceId, [e])
    }
    return map
  }, [events])

  const rows = useMemo(() => {
    return workflows
      .map((wf) => {
        const tasks = wf.tasks
          .map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            cost: rollup(t.agentId ? (byWorkspace.get(t.agentId) ?? []) : [], pricing)
          }))
          .filter((t) => t.cost.eventCount > 0)
        const total = mergeRollups(tasks.map((t) => t.cost))
        return { workflow: wf, tasks, total }
      })
      .filter((r) => r.total.eventCount > 0)
  }, [workflows, byWorkspace, pricing])

  if (rows.length === 0) return null

  return (
    <div className="space-y-3">
      {rows.map(({ workflow, tasks, total }) => (
        <div key={workflow.id} className="rounded-xl border border-hair bg-surface-2">
          <div className="flex items-center justify-between border-b border-hair px-4 py-2.5">
            <span className="truncate text-sm font-medium text-content">{workflow.name}</span>
            <span className="shrink-0 font-mono text-sm tabular-nums text-accent">
              {formatRollupCost(total)}
              <span className="ml-2 text-xs text-content-faint">
                {formatTokens(totalTokens(total))} tok
              </span>
            </span>
          </div>
          <ul>
            {tasks.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between px-4 py-1.5 text-xs last:pb-2.5"
              >
                <span className="flex min-w-0 items-center gap-2 text-content-muted">
                  <span className="truncate">{t.title}</span>
                  <span className="shrink-0 text-content-faint">· {t.status}</span>
                </span>
                <span className="shrink-0 font-mono tabular-nums text-content-muted">
                  {formatRollupCost(t.cost)} · {formatTokens(totalTokens(t.cost))} tok
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function totalTokens(r: CostRollup): number {
  return r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens
}

function mergeRollups(rollups: CostRollup[]): CostRollup {
  return rollups.reduce<CostRollup>(
    (acc, r) => ({
      costUsd: acc.costUsd + r.costUsd,
      complete: acc.complete && r.complete,
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      cacheCreationTokens: acc.cacheCreationTokens + r.cacheCreationTokens,
      cacheReadTokens: acc.cacheReadTokens + r.cacheReadTokens,
      eventCount: acc.eventCount + r.eventCount
    }),
    {
      costUsd: 0,
      complete: true,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      eventCount: 0
    }
  )
}
