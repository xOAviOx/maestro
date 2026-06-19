import { useState } from 'react'
import { useStore } from '../store'
import { TestResultBadge, ranAtLabel } from './TestResultBadge'
import type { Workspace } from '@shared/types'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'

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
    <div className="border-b border-hair bg-surface/30 px-5 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void runTests(workspace.id)}
          disabled={running || !configured}
          title={
            configured ? `Run: ${repoInfo?.testCommand} (⌘↵)` : 'Configure a test command in Settings'
          }
        >
          <Icon name="tests" size={14} />
          {running ? 'Running tests…' : 'Run tests'}
        </Button>

        <TestResultBadge result={result} running={running} />

        {result && !running && (
          <>
            <span className="text-content-faint">·</span>
            <span className="text-content-faint" title={result.command}>
              ran {ranAtLabel(result)}
            </span>
            <button
              className="text-content-muted hover:text-content"
              onClick={() => setShowOutput((v) => !v)}
            >
              {showOutput ? 'hide output' : 'show output'}
            </button>
          </>
        )}

        {!configured && (
          <span className="text-content-faint">
            No test command — set one in Settings → Repository.
          </span>
        )}
      </div>

      {showOutput && result && (
        <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-hair bg-bg p-2 font-mono text-[11px] leading-relaxed text-content-muted whitespace-pre-wrap">
          {result.output || '(no output)'}
          {result.truncated ? '\n…(truncated)' : ''}
        </pre>
      )}
    </div>
  )
}
