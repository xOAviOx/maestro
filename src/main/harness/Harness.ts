import type { AgentEvent, AgentType } from '@shared/types'

/**
 * Options for a single agent turn. The supervisor builds these; the harness
 * translates them into a CLI invocation.
 */
export interface LaunchOptions {
  /** Becomes the process cwd — all edits land in this isolated worktree. */
  worktreePath: string
  /** The user's task / message for this turn. */
  prompt: string
  /** Optional model override. */
  model?: string
  /** When set, resume the agent's prior session (multi-turn continuity). */
  resumeSessionId?: string | null
}

/**
 * The single abstraction the rest of the app depends on. Only ClaudeCodeHarness
 * is fully implemented; Codex/Cursor are stubs that satisfy the interface and
 * throw HarnessNotConfiguredError when launched. Nothing outside the harness
 * factory branches on agent type.
 */
export interface Harness {
  readonly type: AgentType

  /** True if this harness can run on this machine (binary present, etc.). */
  isAvailable(): Promise<boolean>

  /**
   * Run one turn. Emits AgentEvents via `onEvent` as they arrive. Resolves with
   * the session id (for resume) when the turn completes.
   */
  run(opts: LaunchOptions, onEvent: (e: AgentEvent) => void): Promise<{ sessionId: string }>

  /** Cancel an in-flight run. */
  cancel(): void
}
