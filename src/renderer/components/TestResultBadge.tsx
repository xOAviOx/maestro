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
      <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-slate-800 text-slate-300">
        ⟳ running…
      </span>
    )
  }
  if (!result) {
    return <span className="text-[11px] text-slate-500">not run</span>
  }
  const secs = (result.durationMs / 1000).toFixed(1)
  if (result.timedOut) {
    return (
      <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-amber-900/50 text-amber-300">
        ⏱ timeout · {secs}s
      </span>
    )
  }
  if (result.ok) {
    return (
      <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-emerald-900/50 text-emerald-300">
        ✓ passed · {secs}s
      </span>
    )
  }
  return (
    <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-red-900/50 text-red-300">
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
