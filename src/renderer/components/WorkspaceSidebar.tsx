import { useState } from 'react'
import { useStore } from '../store'
import { StatusDot } from './StatusDot'
import { NewWorkspaceDialog } from './NewWorkspaceDialog'
import { SettingsDialog } from './SettingsDialog'

/** Left rail: repo picker + workspace list with live status dots. */
export function WorkspaceSidebar(): JSX.Element {
  const repos = useStore((s) => s.repos)
  const activeRepoPath = useStore((s) => s.activeRepoPath)
  const workspaces = useStore((s) => s.workspaces)
  const selectedWorkspaceId = useStore((s) => s.selectedWorkspaceId)
  const agentAuth = useStore((s) => s.agentAuth)
  const openRepo = useStore((s) => s.openRepo)
  const selectRepo = useStore((s) => s.selectRepo)
  const selectWorkspace = useStore((s) => s.selectWorkspace)

  const [showNew, setShowNew] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const claude = agentAuth['claude-code']
  const accountLabel = !claude.installed
    ? 'Claude Code: not installed'
    : claude.loggedIn
      ? 'Claude Code: logged in'
      : 'Claude Code: logged out'

  return (
    <aside className="flex h-full w-72 flex-col border-r border-slate-800 bg-slate-900/60">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold tracking-tight">Maestro</span>
        <button
          className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
          onClick={() => setShowSettings(true)}
          title="Settings & accounts"
        >
          ⚙ Settings
        </button>
      </div>

      {/* Repo picker */}
      <div className="flex gap-2 px-3 pb-3">
        <select
          className="min-w-0 flex-1 truncate rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs outline-none focus:border-slate-500"
          value={activeRepoPath ?? ''}
          onChange={(e) => void selectRepo(e.target.value)}
        >
          {repos.length === 0 && <option value="">No repos opened</option>}
          {repos.map((r) => (
            <option key={r.path} value={r.path} title={r.path}>
              {r.name}
            </option>
          ))}
        </select>
        <button
          className="rounded-md border border-slate-700 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          onClick={() => void openRepo()}
          title="Open a Git repository"
        >
          Open…
        </button>
      </div>

      {/* New workspace */}
      <div className="px-3 pb-2">
        <button
          className="w-full rounded-md bg-status-running/90 px-3 py-2 text-xs font-medium text-white hover:bg-status-running disabled:opacity-40"
          onClick={() => setShowNew(true)}
          disabled={!activeRepoPath}
        >
          + New workspace
        </button>
      </div>

      {/* Workspace list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {workspaces.length === 0 ? (
          <p className="px-2 py-4 text-xs text-slate-500">
            {activeRepoPath ? 'No workspaces yet.' : 'Open a repo to get started.'}
          </p>
        ) : (
          <ul className="space-y-1">
            {workspaces.map((w) => {
              const selected = w.id === selectedWorkspaceId
              return (
                <li key={w.id}>
                  <button
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
                      selected ? 'bg-slate-800' : 'hover:bg-slate-800/50'
                    }`}
                    onClick={() => selectWorkspace(w.id)}
                  >
                    <StatusDot status={w.status} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{w.name}</span>
                      <span className="block truncate text-xs text-slate-500">{w.branch}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-slate-800 px-3 py-2">
        <button
          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-slate-400 hover:bg-slate-800/50"
          onClick={() => setShowSettings(true)}
          title="Manage agent accounts"
        >
          <span className="truncate">{accountLabel}</span>
          <span
            className={`ml-2 h-2 w-2 shrink-0 rounded-full ${
              claude.loggedIn ? 'bg-emerald-400' : claude.installed ? 'bg-amber-400' : 'bg-slate-600'
            }`}
          />
        </button>
      </div>

      {showNew && <NewWorkspaceDialog onClose={() => setShowNew(false)} />}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </aside>
  )
}
