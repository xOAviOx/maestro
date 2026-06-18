import { useEffect, useState } from 'react'
import { ipc } from '../ipc'
import { useStore, type ChatItem } from '../store'
import { StatusDot, statusLabel } from './StatusDot'
import { TestResultBadge } from './TestResultBadge'
import type { Workspace } from '@shared/types'

/** Last assistant_text in a workspace's transcript, for a one-line preview. */
function lastAssistantText(items: ChatItem[] | undefined): string {
  if (!items) return ''
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!
    if (it.source === 'agent' && it.event.kind === 'assistant_text') return it.event.text
  }
  return ''
}

/**
 * Side-by-side comparison of a fan-out group's variants: status, changed-file
 * count, latest agent message, and test result — so the user can pick a winner.
 * Mounted as the "Compare" tab (only when the workspace has a groupId).
 *
 * Diff counts are fetched per variant here (reusing ipc.getDiff) and refreshed
 * when any variant's status changes — we show counts + file names only, never
 * full Monaco for every variant (perf). "Open full diff" drills into one.
 */
export function VariantComparison({
  workspace,
  onOpenDiff
}: {
  workspace: Workspace
  onOpenDiff: (id: string) => void
}): JSX.Element {
  const siblings = useStore((s) =>
    s.workspaces.filter((w) => w.groupId && w.groupId === workspace.groupId)
  )
  const chats = useStore((s) => s.chats)
  const testResults = useStore((s) => s.testResults)
  const testRunning = useStore((s) => s.testRunning)
  const runTests = useStore((s) => s.runTests)
  const runTestsForGroup = useStore((s) => s.runTestsForGroup)
  const archiveSiblings = useStore((s) => s.archiveSiblings)

  const [diffs, setDiffs] = useState<Record<string, { count: number; files: string[] }>>({})

  // A stable signature of (id:status) pairs so the effect refetches after turns.
  const statusSig = siblings.map((w) => `${w.id}:${w.status}`).join(',')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const entries = await Promise.all(
        siblings.map(async (w) => {
          try {
            const d = await ipc.getDiff(w.id)
            return [w.id, { count: d.files.length, files: d.files.map((f) => f.path) }] as const
          } catch {
            return [w.id, { count: 0, files: [] }] as const
          }
        })
      )
      if (!cancelled) setDiffs(Object.fromEntries(entries))
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusSig])

  const anyRunning = siblings.some((w) => testRunning[w.id])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-2">
        <span className="text-xs text-slate-400">
          Comparing {siblings.length} variant{siblings.length === 1 ? '' : 's'}
        </span>
        <button
          className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          onClick={() => void runTestsForGroup(siblings.map((w) => w.id))}
          disabled={anyRunning}
        >
          {anyRunning ? 'Running…' : 'Run all tests'}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {siblings.map((w) => {
            const diff = diffs[w.id]
            const preview = lastAssistantText(chats[w.id])
            return (
              <div
                key={w.id}
                className={`flex flex-col rounded-lg border p-3 ${
                  w.id === workspace.id ? 'border-slate-600 bg-slate-900/60' : 'border-slate-800 bg-slate-900/30'
                }`}
              >
                <div className="flex items-center gap-2">
                  <StatusDot status={w.status} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{w.name}</span>
                  <span className="text-[11px] text-slate-500">{statusLabel(w.status)}</span>
                </div>
                <div className="mt-1 truncate font-mono text-[11px] text-slate-500">{w.branch}</div>

                <div className="mt-2 flex items-center gap-2">
                  <TestResultBadge result={testResults[w.id]} running={testRunning[w.id] ?? false} />
                  <span className="text-[11px] text-slate-500">
                    {diff ? `${diff.count} changed` : '…'}
                  </span>
                </div>

                {preview && (
                  <p className="mt-2 line-clamp-3 max-h-16 overflow-hidden text-xs text-slate-300 whitespace-pre-wrap">
                    {preview}
                  </p>
                )}

                {diff && diff.files.length > 0 && (
                  <ul className="mt-2 max-h-24 overflow-auto rounded border border-slate-800 bg-slate-950 p-1.5 font-mono text-[10px] text-slate-400">
                    {diff.files.slice(0, 12).map((f) => (
                      <li key={f} className="truncate">
                        {f}
                      </li>
                    ))}
                    {diff.files.length > 12 && <li className="text-slate-600">+{diff.files.length - 12} more</li>}
                  </ul>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                    onClick={() => void runTests(w.id)}
                    disabled={testRunning[w.id] ?? false}
                  >
                    Run tests
                  </button>
                  <button
                    className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
                    onClick={() => onOpenDiff(w.id)}
                  >
                    Open full diff
                  </button>
                  <button
                    className="rounded-md border border-amber-700 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-950/40"
                    onClick={() => void archiveSiblings(w.id)}
                    title="Keep this variant; archive the others in the group"
                  >
                    Keep this
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
