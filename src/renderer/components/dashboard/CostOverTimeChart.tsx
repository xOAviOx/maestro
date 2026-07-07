import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { PricingTable, UsageEvent, Workspace } from '@shared/types'
import { cumulativeSeries, formatUsd } from '@shared/usage'
import { agentColor } from './colors'

/**
 * Cumulative cost over the session, stacked by agent (spec item 3). Built from
 * the shared `cumulativeSeries` so the bands always reconcile with the tiles'
 * session total. Live-updating: the parent throttles `events` to ≤1/sec.
 */
export function CostOverTimeChart({
  events,
  workspaces,
  pricing
}: {
  events: UsageEvent[]
  workspaces: Map<string, Workspace>
  pricing: PricingTable | null
}): JSX.Element {
  const agentIds = useMemo(() => {
    const ids = new Set<string>()
    for (const e of events) ids.add(e.workspaceId)
    return [...ids].sort()
  }, [events])

  const data = useMemo(
    () => cumulativeSeries(events, pricing, agentIds),
    [events, pricing, agentIds]
  )

  const nameFor = (id: string): string => workspaces.get(id)?.name ?? `agent ${id.slice(0, 8)}`
  const colorFor = (id: string): string => agentColor(agentIds.indexOf(id))

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-hair bg-surface-2 text-sm text-content-faint">
        Cost over time appears here once agents start recording usage.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-hair bg-surface-2 p-3">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-content-faint">
        Cumulative cost · by agent
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
            <defs>
              {agentIds.map((id) => (
                <linearGradient key={id} id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colorFor(id)} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={colorFor(id)} stopOpacity={0.05} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#23272f" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(t: number) =>
                new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              }
              stroke="#5e6675"
              fontSize={11}
            />
            <YAxis
              stroke="#5e6675"
              fontSize={11}
              width={54}
              tickFormatter={(v: number) => formatUsd(v)}
            />
            <Tooltip
              contentStyle={{
                background: '#0e1014',
                border: '1px solid #2e333d',
                borderRadius: 8,
                fontSize: 12
              }}
              labelStyle={{ color: '#9aa3b2' }}
              labelFormatter={(t) => new Date(t as number).toLocaleTimeString()}
              formatter={(value, key) => [formatUsd(Number(value) || 0), nameFor(String(key))]}
            />
            {agentIds.map((id) => (
              <Area
                key={id}
                type="monotone"
                dataKey={id}
                name={id}
                stackId="cost"
                stroke={colorFor(id)}
                strokeWidth={1.5}
                fill={`url(#grad-${id})`}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
