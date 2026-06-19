import type { TestResult } from '@shared/types'

/**
 * Compact pass/fail chip for a workspace's latest test run, shared by the
 * TestRunnerBar and the variant comparison cards. `running` takes precedence
 * over any prior result.
 */
export function TestResultBadge({
  result,
  running
}: {
  result: TestResult | undefined
  running: boolean
}): JSX.Element {
  if (running) {
    return (
      <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-surface-3 text-content-muted">
        ⟳ running…
      </span>
    )
  }
  if (!result) {
    return <span className="text-[11px] text-content-faint">not run</span>
  }
  const secs = (result.durationMs / 1000).toFixed(1)
  if (result.timedOut) {
    return (
      <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-status-awaiting/15 text-status-awaiting">
        ⏱ timeout · {secs}s
      </span>
    )
  }
  if (result.ok) {
    return (
      <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-status-done/15 text-status-done">
        ✓ passed · {secs}s
      </span>
    )
  }
  return (
    <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-status-error/15 text-status-error">
      ✗ exit {result.exitCode} · {secs}s
    </span>
  )
}

/** Relative "ran at" hint (so a kept result's staleness is visible). */
export function ranAtLabel(result: TestResult): string {
  try {
    return new Date(result.ranAt).toLocaleTimeString()
  } catch {
    return result.ranAt
  }
}
