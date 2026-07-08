import type { AgentEvent, AgentType } from '@shared/types'

/** A gated tool the agent wants to run, handed to the approval callback. */
export interface PermissionRequest {
  /** Tool name as the CLI reports it (e.g. 'Write', 'Edit', 'Bash', 'PowerShell'). */
  toolName: string
  /** The tool's input arguments (opaque; shown to the user for context). */
  input: unknown
}

/**
 * The host's decision for a `PermissionRequest`, in the shape Claude Code's
 * stream-json control protocol expects. `allow` proceeds (optionally with a
 * revised input); `deny` blocks just that call and lets the turn continue.
 */
export type PermissionDecision =
  | { behavior: 'allow'; updatedInput?: unknown }
  | { behavior: 'deny'; message?: string }

/**
 * Ask the host whether a gated tool may run. Provided only for interactive
 * (chat) runs; when absent the harness never pauses and behaves exactly as
 * before. Resolving is what un-pauses the agent, so it may take arbitrarily
 * long (it waits on a human).
 */
export type RequestPermission = (req: PermissionRequest) => Promise<PermissionDecision>

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
  /**
   * Extra environment variables merged into the agent process at spawn time
   * (e.g. an optional stored credential for headless machines). Applied on top
   * of the inherited process env. Never logged.
   */
  env?: Record<string, string>
  /**
   * When set, the harness runs in interactive-approval mode: gated tool calls
   * (writes / shell) pause and call this before executing. Omit for autonomous
   * runs — the harness then never pauses (its default, pre-approval behavior).
   */
  requestPermission?: RequestPermission
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
