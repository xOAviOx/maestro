import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipc'
import { PingRequestSchema, type PingResponse } from '@shared/types'
import { log } from '../log'

/**
 * Registers every ipcMain.handle handler. Handlers stay thin: validate the
 * incoming payload with its zod schema, delegate to engine services, and
 * return a serializable result. Never trust the renderer's payload shape.
 *
 * As later modules land, each new channel gets a handler here that parses its
 * request schema before doing any work.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.ping, (_event, rawPayload: unknown): PingResponse => {
    // Validate the payload crossing the boundary — throws on a bad shape,
    // which surfaces to the renderer as a rejected invoke().
    const { message } = PingRequestSchema.parse(rawPayload)
    log.info('ipc.ping', { message })

    return {
      reply: `pong: ${message}`,
      at: new Date().toISOString(),
      versions: {
        electron: process.versions.electron ?? 'unknown',
        chrome: process.versions.chrome ?? 'unknown',
        node: process.versions.node ?? 'unknown'
      }
    }
  })

  log.info('ipc.handlers-registered', { channels: Object.values(IpcChannels) })
}
