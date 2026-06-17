import { useState } from 'react'
import { useStore } from '../store'
import { AgentChat } from './AgentChat'
import { DiffViewer } from './DiffViewer'
import { StatusDot, statusLabel } from './StatusDot'

type Tab = 'chat' | 'diff'

/** Main panel: header for the selected workspace + tabbed chat / diff. */
export function WorkspaceView(): JSX.Element {
  const workspace = useStore((s) => s.workspaces.find((w) => w.id === s.selectedWorkspaceId))
  const archiveWorkspace = useStore((s) => s.archiveWorkspace)
  const [tab, setTab] = useState<Tab>('chat')

  if (!workspace) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-sm text-slate-500">
        Select or create a workspace to begin.
      </div>
    )
  }

  const tabBtn = (id: Tab, label: string): JSX.Element => (
    <button
      className={`rounded-md px-3 py-1 text-xs font-medium ${
        tab === id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-800/50'
      }`}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={workspace.status} />
            <h1 className="truncate text-base font-semibold">{workspace.name}</h1>
            <span className="text-xs text-slate-500">{statusLabel(workspace.status)}</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-slate-500">
            {workspace.branch} ← {workspace.baseBranch}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-slate-900 p-1">
            {tabBtn('chat', 'Chat')}
            {tabBtn('diff', 'Diff')}
          </div>
          <button
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            onClick={() => void archiveWorkspace(workspace.id)}
            title="Remove the worktree and archive this workspace"
          >
            Archive
          </button>
        </div>
      </header>

      {/* Keep both mounted? No — mount the active tab. DiffViewer refetches on
          mount and on status change, which covers "refresh after each turn". */}
      {tab === 'chat' ? <AgentChat workspace={workspace} /> : <DiffViewer workspace={workspace} />}
    </div>
  )
}
