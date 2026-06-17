import { PingResponseSchema, type PingResponse } from '@shared/types'

/**
 * Typed client wrapper around `window.maestro`.
 *
 * Responsibilities:
 *  - give the React app a single import for all main-process calls;
 *  - validate responses with their zod schema, so the renderer only ever
 *    trusts well-formed data coming back across the IPC boundary.
 *
 * The renderer never imports `window.maestro` directly outside this file.
 */
export const ipc = {
  async ping(message: string): Promise<PingResponse> {
    const raw = await window.maestro.ping(message)
    return PingResponseSchema.parse(raw)
  }
}
