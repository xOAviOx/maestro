import type { AgentType } from '@shared/types'
import type { Harness } from './Harness'
import { ClaudeCodeHarness, type ClaudeCodeHarnessOptions } from './ClaudeCodeHarness'
import { CodexHarness } from './CodexHarness'
import { CursorHarness } from './CursorHarness'

/**
 * The single place that maps an agent type to a Harness implementation. This is
 * the ONLY spot in the app allowed to branch on agent type; everything else
 * depends on the Harness interface.
 */
export function createHarness(type: AgentType, opts?: ClaudeCodeHarnessOptions): Harness {
  switch (type) {
    case 'claude-code':
      return new ClaudeCodeHarness(opts)
    case 'codex':
      return new CodexHarness()
    case 'cursor':
      return new CursorHarness()
    default: {
      // Exhaustiveness guard — a new AgentType must be handled here.
      const _exhaustive: never = type
      throw new Error(`Unknown agent type: ${String(_exhaustive)}`)
    }
  }
}

export type {
  Harness,
  LaunchOptions,
  PermissionRequest,
  PermissionDecision,
  RequestPermission
} from './Harness'
export { ClaudeCodeHarness } from './ClaudeCodeHarness'
export type { ClaudeCodeHarnessOptions, ClaudePermissionMode } from './ClaudeCodeHarness'
export { CodexHarness } from './CodexHarness'
export type { CodexHarnessOptions, CodexSandboxMode } from './CodexHarness'
export { CursorHarness } from './CursorHarness'
export {
  getAgentAuthStatus,
  getClaudeAuthStatus,
  getCodexAuthStatus,
  resolveLoginCommand,
  credentialEnvVar
} from './authStatus'
export type { LoginCommand } from './authStatus'
export { resolveClaudeBinary, resolveCodexBinary } from './resolveBinary'
