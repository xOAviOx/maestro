import execa from 'execa'
import type { AgentAuthStatus, AgentType, CredentialKind } from '@shared/types'
import { resolveClaudeBinary, resolveCodexBinary } from './resolveBinary'

/**
 * Per-agent login detection. Modeled on engine/gh.ts: every probe is cheap,
 * non-interactive, `reject:false`, and never throws — a missing or logged-out
 * CLI just reports `{ installed:false }` / `{ loggedIn:false }` so the Accounts
 * UI can degrade gracefully.
 *
 * Hard constraint (do not regress): we only DETECT login state here and let the
 * CLI own its credentials. We never read, store, or inject tokens.
 */

const PROBE_TIMEOUT_MS = 8000

/**
 * Which environment variable a stored credential is injected as at spawn time,
 * per agent + kind. These are the official headless-auth env vars:
 *   Claude Code: CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`, subscription)
 *                ANTHROPIC_API_KEY       (Anthropic Console billing)
 *   Codex:       OPENAI_API_KEY          (API-key auth)
 * A null means that (agent, kind) pair has no supported env injection.
 */
export function credentialEnvVar(agentType: AgentType, kind: CredentialKind): string | null {
  if (agentType === 'claude-code') {
    return kind === 'oauth-token' ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY'
  }
  if (agentType === 'codex') {
    // Codex authenticates with an API key; an OAuth token isn't injectable.
    return kind === 'api-key' ? 'OPENAI_API_KEY' : null
  }
  return null
}

/**
 * Claude Code: `claude auth status --json` prints `{ "loggedIn": boolean, ... }`
 * and exits 0 when the CLI is healthy (verified against Claude Code v2.x). We
 * parse the JSON rather than trust the exit code alone.
 */
export async function getClaudeAuthStatus(): Promise<AgentAuthStatus> {
  const bin = await resolveClaudeBinary()
  if (!bin) return { agentType: 'claude-code', installed: false, loggedIn: false }

  try {
    const res = await execa(bin, ['auth', 'status', '--json'], {
      reject: false,
      windowsHide: true,
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS
    })
    const loggedIn = parseClaudeLoggedIn(res.stdout)
    return { agentType: 'claude-code', installed: true, loggedIn }
  } catch {
    // Binary resolved but the probe failed to run — treat as installed, logged out.
    return { agentType: 'claude-code', installed: true, loggedIn: false }
  }
}

/**
 * Codex: `codex login status` exits 0 when credentials are present, 1 when not
 * (it has no flags). Credentials live in the OS keychain / ~/.codex; we only
 * read the exit code.
 */
export async function getCodexAuthStatus(): Promise<AgentAuthStatus> {
  const bin = await resolveCodexBinary()
  if (!bin) return { agentType: 'codex', installed: false, loggedIn: false }

  try {
    const res = await execa(bin, ['login', 'status'], {
      reject: false,
      windowsHide: true,
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS
    })
    return { agentType: 'codex', installed: true, loggedIn: res.exitCode === 0 }
  } catch {
    return { agentType: 'codex', installed: true, loggedIn: false }
  }
}

/** The CLI command that runs an agent's interactive login flow. */
export interface LoginCommand {
  file: string
  args: string[]
}

/**
 * Resolve the interactive login command for an agent, or null if the CLI isn't
 * installed (or has no login flow). The command is run in a real pty so the
 * user completes the CLI's own OAuth handshake — we never handle credentials.
 *   claude -> `claude auth login`
 *   codex  -> `codex login`
 */
export async function resolveLoginCommand(agentType: AgentType): Promise<LoginCommand | null> {
  switch (agentType) {
    case 'claude-code': {
      const bin = await resolveClaudeBinary()
      return bin ? { file: bin, args: ['auth', 'login'] } : null
    }
    case 'codex': {
      const bin = await resolveCodexBinary()
      return bin ? { file: bin, args: ['login'] } : null
    }
    case 'cursor':
      return null
    default: {
      const _exhaustive: never = agentType
      throw new Error(`Unknown agent type: ${String(_exhaustive)}`)
    }
  }
}

/** Auth status for any agent type. Cursor has no login flow yet (always false). */
export function getAgentAuthStatus(agentType: AgentType): Promise<AgentAuthStatus> {
  switch (agentType) {
    case 'claude-code':
      return getClaudeAuthStatus()
    case 'codex':
      return getCodexAuthStatus()
    case 'cursor':
      return Promise.resolve({ agentType: 'cursor', installed: false, loggedIn: false })
    default: {
      const _exhaustive: never = agentType
      throw new Error(`Unknown agent type: ${String(_exhaustive)}`)
    }
  }
}

function parseClaudeLoggedIn(stdout: string): boolean {
  const text = stdout.trim()
  if (text.length === 0) return false
  try {
    const obj: unknown = JSON.parse(text)
    if (typeof obj === 'object' && obj !== null && 'loggedIn' in obj) {
      return (obj as { loggedIn: unknown }).loggedIn === true
    }
  } catch {
    // not JSON — fall through
  }
  return false
}
