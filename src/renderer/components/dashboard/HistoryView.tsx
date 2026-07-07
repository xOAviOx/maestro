import { useMemo, useState } from 'react'
import type { PricingTable, UsageEvent } from '@shared/types'
import { formatRollupCost, formatTokens, rollup } from '@shared/usage'
import { Input } from '../ui/Field'

/**
 * History of past usage, grouped by calendar day (a stand-in "session" record —
 * usage is persisted as a flat event log, not discrete sessions). Each day shows
 * total cost, tokens, and how many distinct agents ran. A simple from/to date
 * filter narrows the range. Spans all persisted history, not just this session.
 */
export function HistoryView({
  events,
  pricing
}: {
  events: UsageEvent[]
  pricing: PricingTable | null
}): JSX.Element {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const days = useMemo(() => {
    const filtered = events.filter((e) => {
      const day = e.createdAt.slice(0, 10) // YYYY-MM-DD
      if (from && day < from) return false
      if (to && day > to) return false
      return true
    })
    const byDay = new Map<string, UsageEvent[]>()
    for (const e of filtered) {
      const day = e.createdAt.slice(0, 10)
      const arr = byDay.get(day)
      if (arr) arr.push(e)
      else byDay.set(day, [e])
    }
    return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // newest day first
      .map(([day, dayEvents]) => ({
        day,
        cost: rollup(dayEvents, pricing),
        agents: new Set(dayEvents.map((e) => e.workspaceId)).size
      }))
  }, [events, from, to, pricing])

  return (
    <div className="rounded-xl border border-hair bg-surface-2">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hair px-4 py-2.5">
        <span className="text-sm font-medium text-content">History</span>
        <div className="flex items-center gap-2 text-xs text-content-faint">
          <span>from</span>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="!w-auto"
            aria-label="From date"
          />
          <span>to</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="!w-auto"
            aria-label="To date"
          />
          {(from || to) && (
            <button
              className="text-content-muted hover:text-content"
              onClick={() => {
                setFrom('')
                setTo('')
              }}
            >
              clear
            </button>
          )}
        </div>
      </div>

      {days.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-content-faint">
          No usage in this range.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hair text-left text-[11px] uppercase tracking-wide text-content-faint">
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 text-right font-medium">Agents</th>
              <th className="px-4 py-2 text-right font-medium">Turns</th>
              <th className="px-4 py-2 text-right font-medium">Tokens</th>
              <th className="px-4 py-2 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day} className="border-b border-hair/60 last:border-0">
                <td className="px-4 py-2 font-mono text-xs">{d.day}</td>
                <td className="px-4 py-2 text-right tabular-nums">{d.agents}</td>
                <td className="px-4 py-2 text-right tabular-nums">{d.cost.eventCount}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {formatTokens(
                    d.cost.inputTokens +
                      d.cost.outputTokens +
                      d.cost.cacheCreationTokens +
                      d.cost.cacheReadTokens
                  )}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-accent">
                  {formatRollupCost(d.cost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
