import { useMemo } from 'react'
import { useStore } from '../../store'
import { formatRollupCost, formatTokens, rollup } from '@shared/usage'
import { cn } from '../ui/cn'

/**
 * Small live "$0.42 · 128k tok" badge for a single agent/workspace, reused on
 * agent cards across the app (Phase 2.2, item 6). Reads the live usage working
 * set from the store; shows nothing until the agent has recorded any usage, so
 * it never implies a false $0 for an agent that simply hasn't reported yet.
 */
export function CostBadge({
  workspaceId,
  className
}: {
  workspaceId: string
  className?: string
}): JSX.Element | null {
  const usageEvents = useStore((s) => s.usageEvents)
  const pricing = useStore((s) => s.pricing)

  const r = useMemo(
    () => rollup(usageEvents.filter((e) => e.workspaceId === workspaceId), pricing),
    [usageEvents, pricing, workspaceId]
  )

  if (r.eventCount === 0) return null
  const tokens = r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-hair bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-content-muted',
        className
      )}
      title={`${r.eventCount} usage samples`}
    >
      <span className="text-accent">{formatRollupCost(r)}</span>
      <span className="text-content-faint">· {formatTokens(tokens)} tok</span>
    </span>
  )
}
