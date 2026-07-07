import { useMemo, useState } from 'react'
import type { PricingTable, UsageEvent, Workspace, WorkspaceStatus } from '@shared/types'
import type { CostRollup } from '@shared/usage'
import { formatRollupCost, formatTokens, rollup } from '@shared/usage'
import { agentColor } from './colors'
import { cn } from '../ui/cn'

interface AgentRow {
  workspaceId: string
  name: string
  model: string | null
  status: WorkspaceStatus | null
  cost: CostRollup
  tokens: number
  durationMs: number
  color: string
}

type SortKey = 'name' | 'model' | 'tokens' | 'cost' | 'duration'

const STATUS_CLS: Record<WorkspaceStatus, string> = {
  idle: 'text-content-faint',
  running: 'text-status-running',
  awaiting_input: 'text-status-awaiting',
  done: 'text-status-done',
  error: 'text-status-error'
}

/**
 * Per-agent usage breakdown. Rows aggregate the (session) events by workspace;
 * columns are sortable. The parent throttles the events it passes to ≤1/sec, so
 * running agents update live without re-rendering on every push.
 */
export function AgentUsageTable({
  events,
  workspaces,
  pricing,
  now
}: {
  events: UsageEvent[]
  workspaces: Map<string, Workspace>
  pricing: PricingTable | null
  now: number
}): JSX.Element {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'cost',
    dir: 'desc'
  })

  const rows = useMemo<AgentRow[]>(() => {
    const byAgent = new Map<string, UsageEvent[]>()
    for (const e of events) {
      const arr = byAgent.get(e.workspaceId)
      if (arr) arr.push(e)
      else byAgent.set(e.workspaceId, [e])
    }
    const ids = [...byAgent.keys()].sort()
    return ids.map((id, i) => {
      const agentEvents = byAgent.get(id) ?? []
      const cost = rollup(agentEvents, pricing)
      const times = agentEvents.map((e) => Date.parse(e.createdAt))
      const ws = workspaces.get(id)
      const running = ws?.status === 'running'
      const first = Math.min(...times)
      const last = running ? now : Math.max(...times)
      // Most recent event's model (events retain store order, newest first).
      const model = agentEvents.find((e) => e.model)?.model ?? null
      return {
        workspaceId: id,
        name: ws?.name ?? `agent ${id.slice(0, 8)}`,
        model,
        status: ws?.status ?? null,
        cost,
        tokens:
          cost.inputTokens + cost.outputTokens + cost.cacheCreationTokens + cost.cacheReadTokens,
        durationMs: Number.isFinite(first) ? Math.max(0, last - first) : 0,
        color: agentColor(i)
      }
    })
  }, [events, workspaces, pricing, now])

  const sorted = useMemo(() => {
    const factor = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      switch (sort.key) {
        case 'name':
          return factor * a.name.localeCompare(b.name)
        case 'model':
          return factor * (a.model ?? '').localeCompare(b.model ?? '')
        case 'tokens':
          return factor * (a.tokens - b.tokens)
        case 'duration':
          return factor * (a.durationMs - b.durationMs)
        case 'cost':
        default:
          return factor * (a.cost.costUsd - b.cost.costUsd)
      }
    })
  }, [rows, sort])

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-hair bg-surface-2 px-4 py-8 text-center text-sm text-content-faint">
        No agent usage recorded this session yet.
      </div>
    )
  }

  const toggle = (key: SortKey): void =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))

  return (
    <div className="overflow-x-auto rounded-xl border border-hair">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-hair bg-surface-2 text-left text-[11px] uppercase tracking-wide text-content-faint">
            <Th label="Agent" sortKey="name" sort={sort} onSort={toggle} />
            <Th label="Model" sortKey="model" sort={sort} onSort={toggle} />
            <Th label="Tokens" sortKey="tokens" sort={sort} onSort={toggle} align="right" />
            <th className="px-3 py-2 text-right font-medium">In / Out / Cache</th>
            <Th label="Cost" sortKey="cost" sort={sort} onSort={toggle} align="right" />
            <th className="px-3 py-2 font-medium">Status</th>
            <Th label="Duration" sortKey="duration" sort={sort} onSort={toggle} align="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.workspaceId} className="border-b border-hair/60 last:border-0">
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: r.color }}
                  />
                  <span className="truncate">{r.name}</span>
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-xs text-content-muted">{r.model ?? '—'}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{formatTokens(r.tokens)}</td>
              <td className="px-3 py-2 text-right font-mono text-xs text-content-faint tabular-nums">
                {formatTokens(r.cost.inputTokens)} / {formatTokens(r.cost.outputTokens)} /{' '}
                {formatTokens(r.cost.cacheReadTokens + r.cost.cacheCreationTokens)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-accent">
                {formatRollupCost(r.cost)}
              </td>
              <td className="px-3 py-2">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 text-xs',
                    r.status ? STATUS_CLS[r.status] : 'text-content-faint'
                  )}
                >
                  {r.status === 'running' && (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-running" />
                  )}
                  {r.status ?? 'archived'}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs text-content-muted tabular-nums">
                {formatDuration(r.durationMs)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Th({
  label,
  sortKey,
  sort,
  onSort,
  align
}: {
  label: string
  sortKey: SortKey
  sort: { key: SortKey; dir: 'asc' | 'desc' }
  onSort: (key: SortKey) => void
  align?: 'right'
}): JSX.Element {
  const active = sort.key === sortKey
  return (
    <th className={cn('px-3 py-2 font-medium', align === 'right' && 'text-right')}>
      <button
        className={cn('inline-flex items-center gap-1 hover:text-content', active && 'text-content')}
        onClick={() => onSort(sortKey)}
      >
        {label}
        {active && <span aria-hidden>{sort.dir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  )
}

/** `1m 12s`, `45s`, `2h 3m`. */
function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}
