import { useCallback, useEffect, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { ipc, MaestroClientError } from '../ipc'
import { languageForPath } from '../monaco'
import type { DiffFile, FileDiff, Workspace } from '@shared/types'
import { IconButton } from './ui/IconButton'
import { Icon } from './ui/Icon'
import { cn } from './ui/cn'

const STATUS_BADGE: Record<DiffFile['status'], { label: string; cls: string }> = {
  added: { label: 'A', cls: 'text-status-done' },
  modified: { label: 'M', cls: 'text-status-awaiting' },
  deleted: { label: 'D', cls: 'text-status-error' },
  renamed: { label: 'R', cls: 'text-accent' },
  copied: { label: 'C', cls: 'text-accent' },
  'type-changed': { label: 'T', cls: 'text-accent-violet' },
  untracked: { label: 'U', cls: 'text-status-done' }
}

/**
 * File list + side-by-side Monaco diff of a workspace's changes vs its base
 * branch. Re-fetches the file list whenever the workspace's status changes (so
 * it refreshes after each agent turn) and on manual refresh.
 */
export function DiffViewer({ workspace }: { workspace: Workspace }): JSX.Element {
  const [files, setFiles] = useState<DiffFile[]>([])
  const [selected, setSelected] = useState<DiffFile | null>(null)
  const [fileDiff, setFileDiff] = useState<FileDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingList, setLoadingList] = useState(false)

  const loadList = useCallback(
    async (preserveSelection: string | null) => {
      setLoadingList(true)
      setError(null)
      try {
        const diff = await ipc.getDiff(workspace.id)
        setFiles(diff.files)
        const next =
          diff.files.find((f) => f.path === preserveSelection) ?? diff.files[0] ?? null
        setSelected(next)
      } catch (err) {
        setError(err instanceof MaestroClientError ? err.message : String(err))
        setFiles([])
        setSelected(null)
      } finally {
        setLoadingList(false)
      }
    },
    [workspace.id]
  )

  // Refresh the file list when the workspace changes or its status changes
  // (a status flip to awaiting_input/done/error marks the end of a turn).
  useEffect(() => {
    void loadList(selected?.path ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, workspace.status])

  // Load the selected file's content for the diff editor.
  useEffect(() => {
    let cancelled = false
    if (!selected) {
      setFileDiff(null)
      return
    }
    void (async () => {
      try {
        const fd = await ipc.getFileDiff(workspace.id, selected.path, selected.oldPath)
        if (!cancelled) setFileDiff(fd)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof MaestroClientError ? err.message : String(err))
          setFileDiff(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspace.id, selected])

  return (
    <div className="flex min-h-0 flex-1">
      {/* File list */}
      <div className="flex w-64 flex-col border-r border-hair">
        <div className="flex items-center justify-between px-3 py-2 text-xs text-content-muted">
          <span>{files.length} changed</span>
          <IconButton
            className="h-6 w-6"
            onClick={() => void loadList(selected?.path ?? null)}
            title="Refresh diff"
            aria-label="Refresh diff"
          >
            <Icon name="refresh" size={14} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadingList && files.length === 0 ? (
            <p className="px-3 py-3 text-xs text-content-faint">Loading…</p>
          ) : files.length === 0 ? (
            <p className="px-3 py-3 text-xs text-content-faint">No changes vs base.</p>
          ) : (
            <ul>
              {files.map((f) => {
                const badge = STATUS_BADGE[f.status]
                const isSel = selected?.path === f.path
                return (
                  <li key={`${f.status}:${f.path}`}>
                    <button
                      className={cn(
                        'flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left text-xs transition-colors',
                        isSel
                          ? 'border-accent bg-surface-2 text-content'
                          : 'border-transparent text-content-muted hover:bg-surface-2/60 hover:text-content'
                      )}
                      onClick={() => setSelected(f)}
                      title={f.path}
                    >
                      <span className={cn('w-3 font-mono font-bold', badge.cls)}>{badge.label}</span>
                      <span className="min-w-0 flex-1 truncate font-mono">{f.path}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Diff editor */}
      <div className="min-w-0 flex-1">
        {error && <div className="px-4 py-2 text-xs text-status-error">{error}</div>}
        {!selected ? (
          <div className="flex h-full items-center justify-center text-sm text-content-faint">
            Select a file to view its diff.
          </div>
        ) : fileDiff?.binary ? (
          <div className="flex h-full items-center justify-center text-sm text-content-faint">
            Binary or too-large file — not shown.
          </div>
        ) : fileDiff ? (
          <DiffEditor
            key={selected.path}
            original={fileDiff.original}
            modified={fileDiff.modified}
            language={languageForPath(selected.path)}
            theme="vs-dark"
            options={{
              readOnly: true,
              renderSideBySide: true,
              automaticLayout: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 12
            }}
            height="100%"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-content-faint">
            Loading diff…
          </div>
        )}
      </div>
    </div>
  )
}
