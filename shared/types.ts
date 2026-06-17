import { z } from 'zod'

/**
 * Shared types + zod schemas that cross the IPC boundary.
 *
 * Every value flowing main <-> preload <-> renderer is validated against a
 * schema here. As later modules add real domain types (Workspace, AgentEvent,
 * etc.) their schemas live in this file (or files imported here) so that main,
 * preload, and renderer always agree on the wire format.
 */

// ---------------------------------------------------------------------------
// Module 0 — connectivity smoke test (ping/pong)
// ---------------------------------------------------------------------------

export const PingRequestSchema = z.object({
  message: z.string()
})
export type PingRequest = z.infer<typeof PingRequestSchema>

export const PingResponseSchema = z.object({
  reply: z.string(),
  /** ISO-8601 timestamp produced by the main process. */
  at: z.string(),
  /** Electron + Chrome + Node versions, proving we crossed into main. */
  versions: z.object({
    electron: z.string(),
    chrome: z.string(),
    node: z.string()
  })
})
export type PingResponse = z.infer<typeof PingResponseSchema>
