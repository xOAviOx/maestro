import { useCallback, useEffect, useState } from 'react'
import { ipc, MaestroClientError } from '../ipc'
import { useStore } from '../store'
import type { ReviewStatus, Workspace } from '@shared/types'

type Outcome =
  | { kind: 'merged'; base: string }
  | { kind: 'pr'; url: string }
  | { kind: 'conflict'; files: string[] }
  | { kind: 'error'; message: string }

/**
 * Commit + merge / PR / archive controls for a workspace. Surfaces merge
 * conflicts explicitly (the engine aborts the merge and returns the conflicted
 * files) rather than failing silently.
 */
export function ReviewBar({ workspace }: { workspace: Workspace }): JSX.Element {
  const ghAvailable = useStore((s) => s.ghAvailable)
  const refreshWorkspaces = useStore((s) => s.refreshWorkspaces)

  const [review, setReview] = useState<ReviewStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [archiveAfter, setArchiveAfter] = useState(true)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const loadReview = useCallback(async () => {
    try {
      setReview(await ipc.getReviewStatus(workspace.id))
    } catch {
      setReview(null)
    }
  }, [workspace.id])

  useEffect(() => {
    void loadReview()
  }, [loadReview, workspace.status])

  const conflictDetails = (err: unknown): string[] | null => {
    if (err instanceof MaestroClientError && err.code === 'MERGE_CONFLICT') {
      const files = err.details?.['conflictedFiles']
      return Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : []
    }
    return null
  }

  const doMerge = async (): Promise<void> => {
    setBusy(true)
    setOutcome(null)
    try {
      const res = await ipc.mergeWorkspace(workspace.id, { archiveAfter })
      setOutcome({ kind: 'merged', base: res.baseBranch })
      await refreshWorkspaces()
    } catch (err) {
      const conflicts = conflictDetails(err)
      if (conflicts) setOutcome({ kind: 'conflict', files: conflicts })
      else setOutcome({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
      void loadReview()
    }
  }

  const doPr = async (): Promise<void> => {
    setBusy(true)
    setOutcome(null)
    try {
      const res = await ipc.createPullRequest(workspace.id)
      setOutcome({ kind: 'pr', url: res.url })
      await refreshWorkspaces()
    } catch (err) {
      setOutcome({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
      void loadReview()
    }
  }

  const canMerge = !busy && review !== null && review.changedFileCount > 0 && review.baseCheckedOut

  return (
    <div className="border-b border-slate-800 bg-slate-900/40 px-5 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="text-slate-400">
          {review
            ? `${review.changedFileCount} changed${review.hasUncommittedChanges ? ' · uncommitted' : ''}`
            : '…'}
        </span>

        <label className="flex items-center gap-1 text-slate-400">
          <input
            type="checkbox"
            checked={archiveAfter}
            onChange={(e) => setArchiveAfter(e.target.checked)}
          />
          Archive after merge
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button
            className="rounded-md bg-status-done/90 px-3 py-1.5 font-medium text-white hover:bg-status-done disabled:opacity-40"
            onClick={() => void doMerge()}
            disabled={!canMerge}
            title={
              review && !review.baseCheckedOut
                ? `Base branch "${review.baseBranch}" is not checked out in the main repo`
                : `Commit changes and merge into ${workspace.baseBranch}`
            }
          >
            {busy ? 'Working…' : `Merge → ${workspace.baseBranch}`}
          </button>
          <button
            className="rounded-md border border-slate-700 px-3 py-1.5 text-slate-200 hover:bg-slate-800 disabled:opacity-40"
            onClick={() => void doPr()}
            disabled={busy || !ghAvailable}
            title={ghAvailable ? 'Push branch and open a PR via gh' : 'Requires the GitHub CLI (gh), authenticated'}
          >
            Create PR
          </button>
        </div>
      </div>

      {outcome && (
        <div className="mt-2 text-xs">
          {outcome.kind === 'merged' && (
            <span className="text-status-done">✓ Merged into {outcome.base}.</span>
          )}
          {outcome.kind === 'pr' && (
            <span className="text-status-done">
              ✓ PR opened:{' '}
              <a className="underline" href={outcome.url} target="_blank" rel="noreferrer">
                {outcome.url}
              </a>
            </span>
          )}
          {outcome.kind === 'conflict' && (
            <div className="rounded-md border border-red-800 bg-red-950/40 p-2 text-red-300">
              <div className="font-medium">Merge conflict — aborted, nothing was changed.</div>
              <ul className="mt-1 list-inside list-disc font-mono">
                {outcome.files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          {outcome.kind === 'error' && <span className="text-status-error">{outcome.message}</span>}
        </div>
      )}
    </div>
  )
}
