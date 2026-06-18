import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { AgentChat } from './AgentChat'
import { DiffViewer } from './DiffViewer'
import { ReviewBar } from './ReviewBar'
import { TestRunnerBar } from './TestRunnerBar'
import { TerminalView } from './TerminalView'
import { VariantComparison } from './VariantComparison'
import { StatusDot, statusLabel } from './StatusDot'

type Tab = 'chat' | 'diff' | 'terminal' | 'compare'

/** Main panel: header for the selected workspace + tabbed chat / diff. */
export function WorkspaceView(): JSX.Element {
  const workspace = useStore((s) => s.workspaces.find((w) => w.id === s.selectedWorkspaceId))
  const archiveWorkspace = useStore((s) => s.archiveWorkspace)
  const archiveSiblings = useStore((s) => s.archiveSiblings)
  const selectWorkspace = useStore((s) => s.selectWorkspace)
  const [tab, setTab] = useState<Tab>('chat')

  const inGroup = Boolean(workspace?.groupId)

  // If the Compare tab is open and the group goes away (after "keep"), fall back.
  useEffect(() => {
    if (tab === 'compare' && !inGroup) setTab('chat')
  }, [tab, inGroup])

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
            {tabBtn('terminal', 'Terminal')}
            {inGroup && tabBtn('compare', '⑃ Compare')}
          </div>
          <button
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            onClick={() => void archiveWorkspace(workspace.id)}
            title="Remove the worktree and archive this workspace"
          >
            Archive
          </button>
          {workspace.groupId && (
            <button
              className="rounded-md border border-amber-700 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-950/40"
              onClick={() => void archiveSiblings(workspace.id)}
              title="Keep this variant; archive the other variants in its fan-out group"
            >
              Keep this · archive others
            </button>
          )}
        </div>
      </header>

      <ReviewBar workspace={workspace} />
      <TestRunnerBar workspace={workspace} />

      {/* Mount the active tab. DiffViewer refetches on mount and on status
          change, which covers "refresh after each turn". The pty behind the
          terminal persists in main across tab switches. */}
      {tab === 'chat' && <AgentChat workspace={workspace} />}
      {tab === 'diff' && <DiffViewer workspace={workspace} />}
      {tab === 'terminal' && <TerminalView workspace={workspace} />}
      {tab === 'compare' && (
        <VariantComparison
          workspace={workspace}
          onOpenDiff={(id) => {
            selectWorkspace(id)
            setTab('diff')
          }}
        />
      )}
    </div>
  )
}
