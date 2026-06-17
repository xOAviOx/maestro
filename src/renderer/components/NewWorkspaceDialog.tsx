import { useState } from 'react'
import { AGENT_TYPES, type AgentType } from '@shared/types'
import { useStore } from '../store'

const AGENT_LABELS: Record<AgentType, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor'
}

/** Modal to create a new workspace: name, base branch, and agent type. */
export function NewWorkspaceDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const repoInfo = useStore((s) => s.repoInfo)
  const createWorkspace = useStore((s) => s.createWorkspace)
  const claudeAuth = useStore((s) => s.agentAuth['claude-code'])
  const loading = useStore((s) => s.loading)

  const [name, setName] = useState('')
  const [baseBranch, setBaseBranch] = useState(repoInfo?.defaultBaseBranch ?? 'main')
  const [agentType] = useState<AgentType>('claude-code')

  const branches = repoInfo?.branches ?? []
  const canSubmit = name.trim().length > 0 && baseBranch.length > 0 && !loading

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    await createWorkspace(name.trim(), baseBranch, agentType)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">New workspace</h2>

        <label className="mb-1 block text-xs font-medium text-slate-400">Name</label>
        <input
          autoFocus
          className="mb-4 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
          placeholder="e.g. add login page"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />

        <label className="mb-1 block text-xs font-medium text-slate-400">Base branch</label>
        <select
          className="mb-4 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
          value={baseBranch}
          onChange={(e) => setBaseBranch(e.target.value)}
        >
          {branches.length === 0 && <option value={baseBranch}>{baseBranch}</option>}
          {branches.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-xs font-medium text-slate-400">Agent</label>
        <select
          className="mb-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
          value={agentType}
          disabled
        >
          {AGENT_TYPES.map((t) => (
            <option key={t} value={t} disabled={t !== 'claude-code'}>
              {AGENT_LABELS[t]}
              {t !== 'claude-code' ? ' (coming soon)' : ''}
            </option>
          ))}
        </select>
        {!claudeAuth.installed && (
          <p className="mb-2 text-xs text-status-error">
            Claude Code CLI not found on PATH — agents won&apos;t run until it&apos;s installed.
          </p>
        )}
        {claudeAuth.installed && !claudeAuth.loggedIn && (
          <p className="mb-2 text-xs text-amber-400">
            Claude Code isn&apos;t logged in — open Settings → Accounts to sign in before running an
            agent.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="rounded-md bg-status-running px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {loading ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
