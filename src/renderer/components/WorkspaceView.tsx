import { useEffect } from 'react'
import { useStore, type WorkspaceTab } from '../store'
import { AgentChat } from './AgentChat'
import { DiffViewer } from './DiffViewer'
import { ReviewBar } from './ReviewBar'
import { TestRunnerBar } from './TestRunnerBar'
import { TerminalView } from './TerminalView'
import { VariantComparison } from './VariantComparison'
import { StatusDot, statusLabel } from './StatusDot'
import { Button } from './ui/Button'
import { Icon, type IconName } from './ui/Icon'
import { cn } from './ui/cn'

/** Main panel: header for the selected workspace + tabbed chat / diff. */
export function WorkspaceView(): JSX.Element {
  const workspace = useStore((s) => s.workspaces.find((w) => w.id === s.selectedWorkspaceId))
  const archiveWorkspace = useStore((s) => s.archiveWorkspace)
  const archiveSiblings = useStore((s) => s.archiveSiblings)
  const selectWorkspace = useStore((s) => s.selectWorkspace)
  const tab = useStore((s) => s.activeTab)
  const setTab = useStore((s) => s.setActiveTab)
  const setActiveDialog = useStore((s) => s.setActiveDialog)

  const inGroup = Boolean(workspace?.groupId)

  // If the Compare tab is open and the group goes away (after "keep"), fall back.
  useEffect(() => {
    if (tab === 'compare' && !inGroup) setTab('chat')
  }, [tab, inGroup, setTab])

  if (!workspace) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 text-center">
        <span className="text-content-faint">
          <Icon name="spark" size={36} />
        </span>
        <p className="text-sm text-content-muted">Select a workspace, or create one to begin.</p>
        <Button variant="primary" onClick={() => setActiveDialog('new')}>
          <Icon name="plus" />
          New workspace
        </Button>
        <p className="text-xs text-content-faint">Tip: press ⌘N anytime</p>
      </div>
    )
  }

  const tabBtn = (id: WorkspaceTab, label: string, icon: IconName): JSX.Element => (
    <button
      className={cn(
        'flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors',
        tab === id
          ? 'bg-accent text-bg shadow-[0_0_14px_-4px_rgba(34,211,238,0.6)]'
          : 'text-content-muted hover:bg-surface-3 hover:text-content'
      )}
      onClick={() => setTab(id)}
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="app-drag flex items-center justify-between border-b border-hair px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={workspace.status} />
            <h1 className="truncate text-base font-semibold text-content">{workspace.name}</h1>
            <span className="text-xs text-content-faint">{statusLabel(workspace.status)}</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-content-faint">
            {workspace.branch} ← {workspace.baseBranch}
          </div>
        </div>
        <div className="no-drag flex items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-hair bg-surface-2 p-1">
            {tabBtn('chat', 'Chat', 'chat')}
            {tabBtn('diff', 'Diff', 'diff')}
            {tabBtn('terminal', 'Terminal', 'terminal')}
            {inGroup && tabBtn('compare', 'Compare', 'compare')}
          </div>
          <Button
            variant="ghost"
            onClick={() => void archiveWorkspace(workspace.id)}
            title="Remove the worktree and archive this workspace"
          >
            <Icon name="archive" />
            Archive
          </Button>
          {workspace.groupId && (
            <Button
              variant="secondary"
              className="border-status-awaiting/50 text-status-awaiting hover:border-status-awaiting hover:bg-status-awaiting/10"
              onClick={() => void archiveSiblings(workspace.id)}
              title="Keep this variant; archive the other variants in its fan-out group"
            >
              <Icon name="keep" />
              Keep this
            </Button>
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
