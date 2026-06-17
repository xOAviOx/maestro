import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '@shared/ipc'
import type { MaestroApi } from '@shared/ipc'

/**
 * The single bridge between the sandboxed renderer and the main process.
 *
 * Hard constraint: the renderer never touches fs/child_process/node-pty. It
 * only sees `window.maestro`, this typed surface. Each method forwards to a
 * named IPC channel; main validates the payload there. Response validation
 * (zod) happens on the renderer side in `src/renderer/ipc.ts` so this preload
 * stays a thin, dependency-free pass-through suitable for `sandbox: true`.
 *
 * Imports here are type-only (erased at build) except `electron` itself, which
 * is available inside a sandboxed preload.
 */
const api: MaestroApi = {
  ping: (message: string) => ipcRenderer.invoke(IpcChannels.ping, { message })
}

contextBridge.exposeInMainWorld('maestro', api)
