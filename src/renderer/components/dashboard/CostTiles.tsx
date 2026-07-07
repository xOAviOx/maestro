import type { CostRollup } from '@shared/usage'
import { formatRollupCost, formatTokens } from '@shared/usage'
import { Icon } from '../ui/Icon'
import { Tooltip } from '../ui/Tooltip'

/**
 * Top-row live tiles: total cost this session, total tokens this session, the
 * trailing-5-min burn rate, and the active-agent count. Values are computed by
 * the parent (throttled ≤1/sec) and passed in — this component is pure display.
 */
export function CostTiles({
  session,
  burnRateTokensPerMin,
  activeAgents
}: {
  session: CostRollup
  burnRateTokensPerMin: number
  activeAgents: number
}): JSX.Element {
  const tokens =
    session.inputTokens +
    session.outputTokens +
    session.cacheCreationTokens +
    session.cacheReadTokens

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile
        label="Session cost"
        value={formatRollupCost(session)}
        accent
        hint={
          session.complete
            ? undefined
            : 'Some agents used a model with no known price and no CLI-reported cost, so this total is a lower bound.'
        }
      />
      <Tile label="Session tokens" value={formatTokens(tokens)} sub={`${session.eventCount} turns`} />
      <Tile
        label="Burn rate"
        value={`${formatTokens(burnRateTokensPerMin)}/min`}
        sub="trailing 5 min"
      />
      <Tile label="Active agents" value={`${activeAgents}`} sub="running now" live={activeAgents > 0} />
    </div>
  )
}

function Tile({
  label,
  value,
  sub,
  hint,
  accent,
  live
}: {
  label: string
  value: string
  sub?: string
  hint?: string
  accent?: boolean
  live?: boolean
}): JSX.Element {
  return (
    <div className="rounded-xl border border-hair bg-surface-2 px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-content-faint">
        {label}
        {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-running" />}
        {hint && (
          <Tooltip label={hint} side="bottom">
            <span className="text-content-faint">
              <Icon name="spark" size={12} />
            </span>
          </Tooltip>
        )}
      </div>
      <div
        className={`mt-1 font-mono text-2xl tabular-nums ${accent ? 'text-accent' : 'text-content'}`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-content-faint">{sub}</div>}
    </div>
  )
}
