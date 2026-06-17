import type { PingRequest, PingResponse } from './types'

/**
 * IPC channel names. Centralized so main (ipcMain.handle) and preload
 * (ipcRenderer.invoke) never disagree on a magic string.
 */
export const IpcChannels = {
  ping: 'maestro:ping'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

/**
 * The typed API surface exposed on `window.maestro` by the preload script.
 * The renderer programs against this interface; the preload implements it.
 * This is the single source of truth for what the renderer can ask main to do.
 */
export interface MaestroApi {
  /** Connectivity smoke test: round-trips a string through the main process. */
  ping(message: string): Promise<PingResponse>
}

// Re-export the request type so preload/main can reference it without reaching
// into types.ts directly when wiring the ping handler.
export type { PingRequest, PingResponse }
