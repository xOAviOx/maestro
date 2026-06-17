import { HarnessNotConfiguredError } from '../engine/errors'
import type { Harness } from './Harness'

/**
 * Stub. Satisfies the Harness interface so the rest of the app never branches
 * on agent type; throws HarnessNotConfiguredError when launched. Fill in later
 * (drive the Cursor CLI agent) without touching callers.
 */
export class CursorHarness implements Harness {
  readonly type = 'cursor' as const

  isAvailable(): Promise<boolean> {
    return Promise.resolve(false)
  }

  run(): Promise<{ sessionId: string }> {
    throw new HarnessNotConfiguredError('cursor')
  }

  cancel(): void {
    // no-op: nothing is ever running
  }
}
