import { HarnessNotConfiguredError } from '../engine/errors'
import type { Harness } from './Harness'

/**
 * Stub. Satisfies the Harness interface so the rest of the app never branches
 * on agent type; throws HarnessNotConfiguredError when launched. Fill in later
 * (drive the Codex CLI in a structured-output mode) without touching callers.
 */
export class CodexHarness implements Harness {
  readonly type = 'codex' as const

  isAvailable(): Promise<boolean> {
    return Promise.resolve(false)
  }

  run(): Promise<{ sessionId: string }> {
    throw new HarnessNotConfiguredError('codex')
  }

  cancel(): void {
    // no-op: nothing is ever running
  }
}
