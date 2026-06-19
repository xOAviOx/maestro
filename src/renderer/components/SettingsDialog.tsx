import { useState } from 'react'
import {
  AGENT_TYPES,
  type AgentAuthStatus,
  type AgentType,
  type CredentialInfo,
  type CredentialKind
} from '@shared/types'
import { useStore } from '../store'
import { LoginTerminal } from './LoginTerminal'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Input, Select } from './ui/Field'
import { Icon } from './ui/Icon'
import { cn } from './ui/cn'

const AGENT_LABELS: Record<AgentType, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor'
}

const AGENT_HINTS: Record<AgentType, string> = {
  'claude-code': 'Sign in with your Claude Pro/Max subscription (or Anthropic Console).',
  codex: 'Sign in with your ChatGPT subscription (Plus/Pro/Business).',
  cursor: 'Cursor agent support is coming soon.'
}

const INSTALL_HINTS: Partial<Record<AgentType, string>> = {
  'claude-code': 'Install the Claude Code CLI and ensure `claude` is on your PATH.',
  codex: 'Install the Codex CLI and ensure `codex` is on your PATH.'
}

/** Agents that have a real login flow wired up. */
const LOGIN_CAPABLE: AgentType[] = ['claude-code', 'codex']

/**
 * Credential kinds each agent accepts as a headless/CI fallback, with the label
 * shown in the Advanced section. Order matters — first is the default.
 */
const CREDENTIAL_KINDS: Partial<Record<AgentType, { kind: CredentialKind; label: string }[]>> = {
  'claude-code': [
    { kind: 'oauth-token', label: 'OAuth token (claude setup-token)' },
    { kind: 'api-key', label: 'Anthropic API key (Console)' }
  ],
  codex: [{ kind: 'api-key', label: 'OpenAI API key' }]
}

/**
 * Accounts settings: detect each agent CLI's install + login state and let the
 * user run the CLI's own login flow in an embedded terminal. Maestro never reads
 * or stores tokens — the CLI owns its credentials (OS keychain / dotfiles).
 */
export function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const agentAuth = useStore((s) => s.agentAuth)
  const agentCredentials = useStore((s) => s.agentCredentials)
  const refreshAgentAuth = useStore((s) => s.refreshAgentAuth)
  const [loginAgent, setLoginAgent] = useState<AgentType | null>(null)

  const beginLogin = (agentType: AgentType): void => setLoginAgent(agentType)

  const finishLogin = (): void => {
    setLoginAgent(null)
    void refreshAgentAuth()
  }

  return (
    <Modal onClose={onClose} title="Settings — Accounts" size="xl">
      {loginAgent ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="mb-2 text-xs text-content-muted">
            Complete the {AGENT_LABELS[loginAgent]} login below. It may open your browser to finish
            sign-in. This pane closes when the CLI reports it&apos;s done.
          </p>
          <div className="flex min-h-[320px] flex-1 flex-col">
            <LoginTerminal agentType={loginAgent} onExit={finishLogin} />
          </div>
          <div className="mt-3 flex justify-end">
            <Button variant="secondary" onClick={finishLogin}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 overflow-y-auto">
          <p className="text-xs text-content-muted">
            Maestro runs each agent through its own CLI login — your subscription stays with the
            provider and no tokens are stored here.
          </p>
          <RepoSettings />
          {AGENT_TYPES.map((t) => (
            <AccountRow
              key={t}
              agentType={t}
              status={agentAuth[t]}
              credential={agentCredentials[t]}
              onLogin={LOGIN_CAPABLE.includes(t) ? () => beginLogin(t) : undefined}
            />
          ))}
          <div className="mt-2 flex justify-between">
            <Button variant="ghost" onClick={() => void refreshAgentAuth()}>
              <Icon name="refresh" />
              Re-check
            </Button>
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function AccountRow({
  agentType,
  status,
  credential,
  onLogin
}: {
  agentType: AgentType
  status: AgentAuthStatus
  credential: CredentialInfo
  onLogin?: () => void
}): JSX.Element {
  const kinds = CREDENTIAL_KINDS[agentType]
  const [showAdvanced, setShowAdvanced] = useState(false)

  return (
    <div className="rounded-xl border border-hair bg-surface-2 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-content">{AGENT_LABELS[agentType]}</span>
            <StatusChip status={status} credential={credential} />
          </div>
          <p className="mt-0.5 truncate text-xs text-content-faint">
            {!status.installed
              ? (INSTALL_HINTS[agentType] ?? AGENT_HINTS[agentType])
              : AGENT_HINTS[agentType]}
          </p>
        </div>
        {onLogin && status.installed && (
          <Button size="sm" variant="secondary" className="ml-3 shrink-0" onClick={onLogin}>
            {status.loggedIn ? 'Re-login' : 'Log in'}
          </Button>
        )}
      </div>

      {kinds && kinds.length > 0 && (
        <div className="mt-2 border-t border-hair pt-2">
          <button
            className="flex items-center gap-1 text-[11px] text-content-faint hover:text-content-muted"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <Icon name={showAdvanced ? 'chevronDown' : 'chevronRight'} size={12} />
            Advanced — headless / CI token
            {credential.configured ? ' (configured)' : ''}
          </button>
          {showAdvanced && (
            <AdvancedCredential agentType={agentType} credential={credential} kinds={kinds} />
          )}
        </div>
      )}
    </div>
  )
}

function AdvancedCredential({
  agentType,
  credential,
  kinds
}: {
  agentType: AgentType
  credential: CredentialInfo
  kinds: { kind: CredentialKind; label: string }[]
}): JSX.Element {
  const setCredential = useStore((s) => s.setCredential)
  const clearCredential = useStore((s) => s.clearCredential)
  const [kind, setKind] = useState<CredentialKind>(kinds[0]!.kind)
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    if (secret.trim().length === 0) return
    setSaving(true)
    try {
      await setCredential(agentType, kind, secret.trim())
      setSecret('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="text-[11px] text-content-faint">
        For machines that can&apos;t run an interactive login. The secret is encrypted with your OS
        keychain and never shown again — use the CLI login above when you can.
      </p>
      {credential.configured && (
        <div className="flex items-center justify-between rounded-lg bg-surface px-2 py-1 text-[11px] text-content-muted">
          <span>
            Token stored{credential.kind ? ` (${credential.kind})` : ''}
            {credential.updatedAt ? ` · ${new Date(credential.updatedAt).toLocaleDateString()}` : ''}
          </span>
          <button
            className="text-status-error hover:opacity-80"
            onClick={() => void clearCredential(agentType)}
          >
            Remove
          </button>
        </div>
      )}
      {kinds.length > 1 && (
        <Select
          className="py-1.5 text-xs"
          value={kind}
          onChange={(e) => setKind(e.target.value as CredentialKind)}
        >
          {kinds.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </Select>
      )}
      <div className="flex gap-2">
        <Input
          type="password"
          className="min-w-0 flex-1 py-1.5 text-xs"
          placeholder={credential.configured ? 'Replace token…' : 'Paste token / API key'}
          value={secret}
          autoComplete="off"
          onChange={(e) => setSecret(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0"
          onClick={() => void save()}
          disabled={saving || secret.trim().length === 0}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

function StatusChip({
  status,
  credential
}: {
  status: AgentAuthStatus
  credential: CredentialInfo
}): JSX.Element {
  let label: string
  let cls: string
  if (status.loggedIn) {
    label = 'Logged in'
    cls = 'bg-status-done/15 text-status-done'
  } else if (credential.configured) {
    label = 'Token set'
    cls = 'bg-status-done/10 text-status-done'
  } else if (!status.installed) {
    label = 'Not installed'
    cls = 'bg-surface-3 text-content-muted'
  } else {
    label = 'Logged out'
    cls = 'bg-status-awaiting/15 text-status-awaiting'
  }
  return <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', cls)}>{label}</span>
}

/**
 * Per-repo settings — currently the test command run inside each workspace's
 * worktree (used by the Run-tests control and the variant comparison view).
 */
function RepoSettings(): JSX.Element | null {
  const repoInfo = useStore((s) => s.repoInfo)
  const activeRepoPath = useStore((s) => s.activeRepoPath)
  const setTestCommand = useStore((s) => s.setTestCommand)

  const [value, setValue] = useState(repoInfo?.testCommand ?? '')
  const [saved, setSaved] = useState(false)

  if (!activeRepoPath || !repoInfo) {
    return (
      <div className="rounded-xl border border-hair bg-surface-2 px-4 py-3 text-xs text-content-faint">
        Open a repository to configure its test command.
      </div>
    )
  }

  const dirty = value !== (repoInfo.testCommand ?? '')

  const save = async (): Promise<void> => {
    await setTestCommand(activeRepoPath, value.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="rounded-xl border border-hair bg-surface-2 px-4 py-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-medium text-content">Repository — {repoInfo.name}</span>
      </div>
      <label className="mb-1 block text-xs text-content-muted">Test command</label>
      <div className="flex gap-2">
        <Input
          className="min-w-0 flex-1 py-1.5 font-mono text-xs"
          placeholder="e.g. pnpm lint && pnpm test"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0"
          onClick={() => void save()}
          disabled={!dirty}
        >
          {saved ? 'Saved' : 'Save'}
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-content-faint">
        Runs in each workspace&apos;s worktree via your shell. Leave empty to disable. Used by
        &ldquo;Run tests&rdquo; and the fan-out comparison view.
      </p>
    </div>
  )
}
