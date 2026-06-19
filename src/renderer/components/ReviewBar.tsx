import { useCallback, useEffect, useState } from 'react'
import { ipc, MaestroClientError } from '../ipc'
import { useStore } from '../store'
import type { ReviewStatus, Workspace } from '@shared/types'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'

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
  const pushToast = useStore((s) => s.pushToast)

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
      pushToast('success', `Merged into ${res.baseBranch}.`)
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
      pushToast('success', 'Pull request opened.')
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
    <div className="border-b border-hair bg-surface/40 px-5 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="text-content-muted">
          {review
            ? `${review.changedFileCount} changed${review.hasUncommittedChanges ? ' · uncommitted' : ''}`
            : '…'}
        </span>

        <label className="flex items-center gap-1.5 text-content-muted">
          <input
            type="checkbox"
            className="accent-accent"
            checked={archiveAfter}
            onChange={(e) => setArchiveAfter(e.target.checked)}
          />
          Archive after merge
        </label>

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="success"
            onClick={() => void doMerge()}
            disabled={!canMerge}
            title={
              review && !review.baseCheckedOut
                ? `Base branch "${review.baseBranch}" is not checked out in the main repo`
                : `Commit changes and merge into ${workspace.baseBranch}`
            }
          >
            <Icon name="merge" size={14} />
            {busy ? 'Working…' : `Merge → ${workspace.baseBranch}`}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void doPr()}
            disabled={busy || !ghAvailable}
            title={
              ghAvailable
                ? 'Push branch and open a PR via gh'
                : 'Requires the GitHub CLI (gh), authenticated'
            }
          >
            <Icon name="pr" size={14} />
            Create PR
          </Button>
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
            <div className="rounded-lg border border-status-error/40 bg-status-error/10 p-2 text-status-error">
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
