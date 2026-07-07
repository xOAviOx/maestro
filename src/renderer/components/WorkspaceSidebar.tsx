import type { Workflow, Workspace } from '@shared/types'
import { useStore } from '../store'
import { StatusDot } from './StatusDot'
import { CostBadge } from './dashboard/CostBadge'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { Icon, type IconName } from './ui/Icon'
import { Select } from './ui/Field'
import { Tooltip } from './ui/Tooltip'
import { cn } from './ui/cn'

/** Left rail: repo picker + a workspaces/workflows switch with live status. */
export function WorkspaceSidebar(): JSX.Element {
  const repos = useStore((s) => s.repos)
  const activeRepoPath = useStore((s) => s.activeRepoPath)
  const workspaces = useStore((s) => s.workspaces)
  const selectedWorkspaceId = useStore((s) => s.selectedWorkspaceId)
  const agentAuth = useStore((s) => s.agentAuth)
  const openRepo = useStore((s) => s.openRepo)
  const selectRepo = useStore((s) => s.selectRepo)
  const selectWorkspace = useStore((s) => s.selectWorkspace)
  const setActiveDialog = useStore((s) => s.setActiveDialog)
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)

  const claude = agentAuth['claude-code']
  const accountLabel = !claude.installed
    ? 'Claude Code: not installed'
    : claude.loggedIn
      ? 'Claude Code: logged in'
      : 'Claude Code: logged out'

  return (
    <aside className="glass flex h-full w-72 flex-col border-r border-hair">
      <div className="app-drag flex items-center justify-between px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold tracking-tight text-content">
          <span className="text-accent">
            <Icon name="spark" size={18} />
          </span>
          Maestro
        </span>
        <Tooltip label="Settings & accounts (⌘,)" side="bottom">
          <IconButton onClick={() => setActiveDialog('settings')} aria-label="Settings">
            <Icon name="settings" />
          </IconButton>
        </Tooltip>
      </div>

      {/* Repo picker */}
      <div className="flex gap-2 px-3 pb-3">
        <Select
          className="min-w-0 flex-1 truncate"
          value={activeRepoPath ?? ''}
          onChange={(e) => void selectRepo(e.target.value)}
        >
          {repos.length === 0 && <option value="">No repos opened</option>}
          {repos.map((r) => (
            <option key={r.path} value={r.path} title={r.path}>
              {r.name}
            </option>
          ))}
        </Select>
        <Tooltip label="Open a Git repository" side="bottom">
          <Button variant="secondary" onClick={() => void openRepo()} aria-label="Open repository">
            <Icon name="folder" />
            Open
          </Button>
        </Tooltip>
      </div>

      {/* Workspaces / Workflows / Dashboard switch */}
      <div className="mx-3 mb-2 flex rounded-lg border border-hair bg-surface-2 p-0.5 text-xs">
        <ViewTab icon="terminal" label="Workspaces" active={view === 'workspaces'} onClick={() => setView('workspaces')} />
        <ViewTab icon="graph" label="Workflows" active={view === 'workflows'} onClick={() => setView('workflows')} />
        <ViewTab icon="chart" label="Cost" active={view === 'dashboard'} onClick={() => setView('dashboard')} />
      </div>

      {view === 'workspaces' ? (
        <>
          {/* New workspace */}
          <div className="flex gap-2 px-3 pb-2">
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => setActiveDialog('new')}
              disabled={!activeRepoPath}
              title="New workspace (⌘N)"
            >
              <Icon name="plus" />
              New workspace
            </Button>
            <Tooltip label="Run one task as competing variants (⌘⇧N)" side="bottom">
              <Button
                variant="secondary"
                onClick={() => setActiveDialog('fanout')}
                disabled={!activeRepoPath}
                aria-label="Fan out"
              >
                <Icon name="fanout" />
              </Button>
            </Tooltip>
          </div>

          {/* Workspace list (fan-out variants grouped under a header). */}
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {workspaces.length === 0 ? (
              <div className="m-auto flex flex-col items-center gap-2 px-4 py-10 text-center">
                <span className="text-content-faint">
                  <Icon name={activeRepoPath ? 'plus' : 'folder'} size={28} />
                </span>
                <p className="text-xs text-content-faint">
                  {activeRepoPath
                    ? 'No workspaces yet. Press ⌘N to create one.'
                    : 'Open a repo to get started.'}
                </p>
              </div>
            ) : (
              <ul className="space-y-1">
                {groupWorkspaces(workspaces).map((entry) =>
                  entry.kind === 'single' ? (
                    <li key={entry.workspace.id}>
                      <WorkspaceRow
                        workspace={entry.workspace}
                        selected={entry.workspace.id === selectedWorkspaceId}
                        onSelect={selectWorkspace}
                      />
                    </li>
                  ) : (
                    <li key={entry.groupId} className="rounded-xl bg-surface-2/50 p-1">
                      <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-content-faint">
                        <Icon name="fanout" size={12} />
                        {groupName(entry.workspaces)} · {entry.workspaces.length} variants
                      </div>
                      <ul className="space-y-1">
                        {entry.workspaces.map((w) => (
                          <li key={w.id}>
                            <WorkspaceRow
                              workspace={w}
                              selected={w.id === selectedWorkspaceId}
                              onSelect={selectWorkspace}
                            />
                          </li>
                        ))}
                      </ul>
                    </li>
                  )
                )}
              </ul>
            )}
          </div>
        </>
      ) : view === 'workflows' ? (
        <WorkflowList />
      ) : (
        <DashboardRail />
      )}

      <div className="space-y-1 border-t border-hair px-3 py-2">
        <button
          className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs text-content-muted transition-colors hover:bg-surface-2"
          onClick={() => setActiveDialog('settings')}
          title="Manage agent accounts"
        >
          <span className="truncate">{accountLabel}</span>
          <span
            className={cn(
              'ml-2 h-2 w-2 shrink-0 rounded-full',
              claude.loggedIn ? 'bg-status-done' : claude.installed ? 'bg-status-awaiting' : 'bg-status-idle'
            )}
          />
        </button>
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-content-faint transition-colors hover:bg-surface-2 hover:text-content-muted"
          onClick={() => setActiveDialog('shortcuts')}
          title="Keyboard shortcuts (?)"
        >
          <Icon name="keyboard" size={14} />
          Keyboard shortcuts
        </button>
      </div>
    </aside>
  )
}

/** One selectable workspace row. */
function WorkspaceRow({
  workspace,
  selected,
  onSelect
}: {
  workspace: Workspace
  selected: boolean
  onSelect: (id: string) => void
}): JSX.Element {
  return (
    <button
      className={cn(
        'flex w-full items-center gap-2 rounded-lg border-l-2 px-2 py-2 text-left text-sm transition-colors',
        selected
          ? 'border-accent bg-surface-2 text-content'
          : 'border-transparent text-content-muted hover:bg-surface-2/60 hover:text-content'
      )}
      onClick={() => onSelect(workspace.id)}
    >
      <StatusDot status={workspace.status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{workspace.name}</span>
        <span className="block truncate font-mono text-xs text-content-faint">{workspace.branch}</span>
      </span>
      <CostBadge workspaceId={workspace.id} className="shrink-0" />
    </button>
  )
}

/**
 * Dashboard rail: agent cards with live cost badges (the same rows as the
 * workspaces list, minus create controls). Reinforces item 6 of the spec —
 * every agent card carries its live cost — right next to the cost view.
 */
function DashboardRail(): JSX.Element {
  const workspaces = useStore((s) => s.workspaces)
  const selectedWorkspaceId = useStore((s) => s.selectedWorkspaceId)
  const selectWorkspace = useStore((s) => s.selectWorkspace)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <div className="px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-content-faint">
        Agents · live cost
      </div>
      {workspaces.length === 0 ? (
        <p className="px-2 py-6 text-center text-xs text-content-faint">
          No agents in this repo yet.
        </p>
      ) : (
        <ul className="space-y-1">
          {workspaces.map((w) => (
            <li key={w.id}>
              <WorkspaceRow
                workspace={w}
                selected={w.id === selectedWorkspaceId}
                onSelect={selectWorkspace}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type ListEntry =
  | { kind: 'single'; workspace: Workspace }
  | { kind: 'group'; groupId: string; workspaces: Workspace[] }

/**
 * Partition workspaces into fan-out groups (2+ sharing a groupId) and singles,
 * preserving the original order (groups anchor at their first member's slot).
 * A lone group member renders as a single (no header for a group of one).
 */
function groupWorkspaces(workspaces: Workspace[]): ListEntry[] {
  const byGroup = new Map<string, Workspace[]>()
  for (const w of workspaces) {
    if (!w.groupId) continue
    const arr = byGroup.get(w.groupId) ?? []
    arr.push(w)
    byGroup.set(w.groupId, arr)
  }
  const emitted = new Set<string>()
  const entries: ListEntry[] = []
  for (const w of workspaces) {
    const members = w.groupId ? byGroup.get(w.groupId) : undefined
    if (w.groupId && members && members.length >= 2) {
      if (emitted.has(w.groupId)) continue
      emitted.add(w.groupId)
      entries.push({ kind: 'group', groupId: w.groupId, workspaces: members })
    } else {
      entries.push({ kind: 'single', workspace: w })
    }
  }
  return entries
}

/** A group's display name = the variant names minus the " · vN" suffix. */
function groupName(members: Workspace[]): string {
  const first = members[0]?.name ?? 'Fan-out'
  return first.replace(/\s*·\s*v\d+\s*$/, '')
}

/** One segment of the Workspaces/Workflows switch. */
function ViewTab({
  icon,
  label,
  active,
  onClick
}: {
  icon: IconName
  label: string
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-medium transition-colors',
        active ? 'bg-surface-3 text-content' : 'text-content-muted hover:text-content'
      )}
      onClick={onClick}
    >
      <Icon name={icon} size={13} />
      {label}
    </button>
  )
}

/** Workflow rail: create button + a list of DAG workflows for the active repo. */
function WorkflowList(): JSX.Element {
  const workflows = useStore((s) => s.workflows)
  const activeRepoPath = useStore((s) => s.activeRepoPath)
  const selectedWorkflowId = useStore((s) => s.selectedWorkflowId)
  const selectWorkflow = useStore((s) => s.selectWorkflow)
  const setActiveDialog = useStore((s) => s.setActiveDialog)

  const mine = workflows.filter((w) => !activeRepoPath || w.repoPath === activeRepoPath)

  return (
    <>
      <div className="px-3 pb-2">
        <Button
          variant="primary"
          className="w-full"
          onClick={() => setActiveDialog('workflow-builder')}
          disabled={!activeRepoPath}
          title="Build a task DAG"
        >
          <Icon name="plus" />
          New workflow
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {mine.length === 0 ? (
          <div className="m-auto flex flex-col items-center gap-2 px-4 py-10 text-center">
            <span className="text-content-faint">
              <Icon name="graph" size={28} />
            </span>
            <p className="text-xs text-content-faint">
              {activeRepoPath ? 'No workflows yet. Create one.' : 'Open a repo to get started.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-1">
            {mine.map((wf) => (
              <li key={wf.id}>
                <WorkflowRow
                  workflow={wf}
                  selected={wf.id === selectedWorkflowId}
                  onSelect={selectWorkflow}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

/** One selectable workflow row with a progress summary. */
function WorkflowRow({
  workflow,
  selected,
  onSelect
}: {
  workflow: Workflow
  selected: boolean
  onSelect: (id: string) => void
}): JSX.Element {
  const merged = workflow.tasks.filter((t) => t.status === 'merged').length
  const running = workflow.tasks.some((t) => t.status === 'running')
  const conflicted = workflow.tasks.some((t) => t.conflict)
  return (
    <button
      className={cn(
        'flex w-full items-center gap-2 rounded-lg border-l-2 px-2 py-2 text-left text-sm transition-colors',
        selected
          ? 'border-accent bg-surface-2 text-content'
          : 'border-transparent text-content-muted hover:bg-surface-2/60 hover:text-content'
      )}
      onClick={() => onSelect(workflow.id)}
    >
      <span
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          conflicted
            ? 'bg-status-error'
            : running
              ? 'animate-pulse bg-status-awaiting'
              : merged === workflow.tasks.length
                ? 'bg-status-done'
                : 'bg-status-idle'
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{workflow.name}</span>
        <span className="block truncate text-xs text-content-faint">
          {merged}/{workflow.tasks.length} merged · {workflow.status}
        </span>
      </span>
    </button>
  )
}
