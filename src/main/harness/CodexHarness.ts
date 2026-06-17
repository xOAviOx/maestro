import { HarnessNotConfiguredError } from '../engine/errors'
import type { Harness } from './Harness'
import { resolveCodexBinary } from './resolveBinary'

/**
 * Run-stub: satisfies the Harness interface so the rest of the app never
 * branches on agent type; throws HarnessNotConfiguredError when launched. Fill
 * in run() later (drive the Codex CLI in a structured-output mode) without
 * touching callers. isAvailable() is real so the Accounts panel can reflect
 * whether the Codex CLI is installed.
 */
export class CodexHarness implements Harness {
  readonly type = 'codex' as const

  async isAvailable(): Promise<boolean> {
    return (await resolveCodexBinary()) !== null
  }

  run(): Promise<{ sessionId: string }> {
    throw new HarnessNotConfiguredError('codex')
  }

  cancel(): void {
    // no-op: nothing is ever running
  }
}
