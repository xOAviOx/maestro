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
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings — Accounts</h2>
          <button className="text-slate-400 hover:text-slate-200" onClick={onClose}>
            ✕
          </button>
        </div>

        {loginAgent ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <p className="mb-2 text-xs text-slate-400">
              Complete the {AGENT_LABELS[loginAgent]} login below. It may open your browser to
              finish sign-in. This pane closes when the CLI reports it&apos;s done.
            </p>
            <div className="flex min-h-[320px] flex-1 flex-col">
              <LoginTerminal agentType={loginAgent} onExit={finishLogin} />
            </div>
            <div className="mt-3 flex justify-end">
              <button
                className="rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
                onClick={finishLogin}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 overflow-y-auto">
            <p className="text-xs text-slate-400">
              Maestro runs each agent through its own CLI login — your subscription stays with the
              provider and no tokens are stored here.
            </p>
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
              <button
                className="rounded-md px-3 py-2 text-sm text-slate-400 hover:bg-slate-800"
                onClick={() => void refreshAgentAuth()}
              >
                Re-check
              </button>
              <button
                className="rounded-md bg-status-running px-4 py-2 text-sm font-medium text-white"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
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
    <div className="rounded-md border border-slate-700 bg-slate-950 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{AGENT_LABELS[agentType]}</span>
            <StatusChip status={status} credential={credential} />
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {!status.installed
              ? (INSTALL_HINTS[agentType] ?? AGENT_HINTS[agentType])
              : AGENT_HINTS[agentType]}
          </p>
        </div>
        {onLogin && status.installed && (
          <button
            className="ml-3 shrink-0 rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
            onClick={onLogin}
          >
            {status.loggedIn ? 'Re-login' : 'Log in'}
          </button>
        )}
      </div>

      {kinds && kinds.length > 0 && (
        <div className="mt-2 border-t border-slate-800 pt-2">
          <button
            className="text-[11px] text-slate-500 hover:text-slate-300"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? '▾' : '▸'} Advanced — headless / CI token
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
      <p className="text-[11px] text-slate-500">
        For machines that can&apos;t run an interactive login. The secret is encrypted with your OS
        keychain and never shown again — use the CLI login above when you can.
      </p>
      {credential.configured && (
        <div className="flex items-center justify-between rounded bg-slate-900 px-2 py-1 text-[11px] text-slate-400">
          <span>
            Token stored{credential.kind ? ` (${credential.kind})` : ''}
            {credential.updatedAt ? ` · ${new Date(credential.updatedAt).toLocaleDateString()}` : ''}
          </span>
          <button
            className="text-red-400 hover:text-red-300"
            onClick={() => void clearCredential(agentType)}
          >
            Remove
          </button>
        </div>
      )}
      {kinds.length > 1 && (
        <select
          className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs outline-none focus:border-slate-500"
          value={kind}
          onChange={(e) => setKind(e.target.value as CredentialKind)}
        >
          {kinds.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      )}
      <div className="flex gap-2">
        <input
          type="password"
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs outline-none focus:border-slate-500"
          placeholder={credential.configured ? 'Replace token…' : 'Paste token / API key'}
          value={secret}
          autoComplete="off"
          onChange={(e) => setSecret(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
          }}
        />
        <button
          className="shrink-0 rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          onClick={() => void save()}
          disabled={saving || secret.trim().length === 0}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
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
    cls = 'bg-emerald-900/60 text-emerald-300'
  } else if (credential.configured) {
    label = 'Token set'
    cls = 'bg-emerald-900/40 text-emerald-300'
  } else if (!status.installed) {
    label = 'Not installed'
    cls = 'bg-slate-800 text-slate-400'
  } else {
    label = 'Logged out'
    cls = 'bg-amber-900/50 text-amber-300'
  }
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{label}</span>
}
