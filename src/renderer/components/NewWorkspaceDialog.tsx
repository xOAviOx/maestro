import { useState } from 'react'
import { AGENT_TYPES, type AgentType } from '@shared/types'
import { useStore } from '../store'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Input, Select, FieldLabel } from './ui/Field'
import { Icon } from './ui/Icon'

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
    <Modal onClose={onClose} title="New workspace" size="md">
      <div className="flex flex-col gap-4">
        <div>
          <FieldLabel>Name</FieldLabel>
          <Input
            autoFocus
            placeholder="e.g. add login page"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
        </div>

        <div>
          <FieldLabel>Base branch</FieldLabel>
          <Select value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)}>
            {branches.length === 0 && <option value={baseBranch}>{baseBranch}</option>}
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <FieldLabel>Agent</FieldLabel>
          <Select value={agentType} disabled>
            {AGENT_TYPES.map((t) => (
              <option key={t} value={t} disabled={t !== 'claude-code'}>
                {AGENT_LABELS[t]}
                {t !== 'claude-code' ? ' (coming soon)' : ''}
              </option>
            ))}
          </Select>
        </div>

        {!claudeAuth.installed && (
          <p className="text-xs text-status-error">
            Claude Code CLI not found on PATH — agents won&apos;t run until it&apos;s installed.
          </p>
        )}
        {claudeAuth.installed && !claudeAuth.loggedIn && (
          <p className="text-xs text-status-awaiting">
            Claude Code isn&apos;t logged in — open Settings → Accounts to sign in before running an
            agent.
          </p>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
          <Icon name="plus" />
          {loading ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </Modal>
  )
}
