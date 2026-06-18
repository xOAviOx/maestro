import { useState } from 'react'
import { useStore } from '../store'
import { TestResultBadge, ranAtLabel } from './TestResultBadge'
import type { Workspace } from '@shared/types'

/**
 * Run-tests control + latest result for one workspace. Runs the repo's
 * configured test command inside the worktree and shows a pass/fail badge with
 * expandable captured output. Sits under the ReviewBar in WorkspaceView.
 */
export function TestRunnerBar({ workspace }: { workspace: Workspace }): JSX.Element {
  const repoInfo = useStore((s) => s.repoInfo)
  const result = useStore((s) => s.testResults[workspace.id])
  const running = useStore((s) => s.testRunning[workspace.id] ?? false)
  const runTests = useStore((s) => s.runTests)

  const [showOutput, setShowOutput] = useState(false)
  const configured = (repoInfo?.testCommand ?? '').trim().length > 0

  return (
    <div className="border-b border-slate-800 bg-slate-900/30 px-5 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          className="rounded-md border border-slate-700 px-3 py-1.5 font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          onClick={() => void runTests(workspace.id)}
          disabled={running || !configured}
          title={configured ? `Run: ${repoInfo?.testCommand}` : 'Configure a test command in Settings'}
        >
          {running ? 'Running tests…' : 'Run tests'}
        </button>

        <TestResultBadge result={result} running={running} />

        {result && !running && (
          <>
            <span className="text-slate-600">·</span>
            <span className="text-slate-500" title={result.command}>
              ran {ranAtLabel(result)}
            </span>
            <button
              className="text-slate-400 hover:text-slate-200"
              onClick={() => setShowOutput((v) => !v)}
            >
              {showOutput ? 'hide output' : 'show output'}
            </button>
          </>
        )}

        {!configured && (
          <span className="text-slate-500">No test command — set one in Settings → Repository.</span>
        )}
      </div>

      {showOutput && result && (
        <pre className="mt-2 max-h-56 overflow-auto rounded-md border border-slate-800 bg-slate-950 p-2 font-mono text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap">
          {result.output || '(no output)'}
          {result.truncated ? '\n…(truncated)' : ''}
        </pre>
      )}
    </div>
  )
}
