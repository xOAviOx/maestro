import { create } from 'zustand'
import { ipc } from './ipc'

/**
 * Global renderer state (Zustand).
 *
 * The renderer is "dumb": it holds state reflecting what main reports and
 * dispatches intents through `ipc`. As later modules land, workspace lists,
 * agent event streams, and selection live here.
 *
 * For Module 0 this just exercises the IPC round-trip end to end.
 */
interface PingState {
  lastReply: string | null
  lastError: string | null
  pinging: boolean
}

interface AppState extends PingState {
  ping: (message: string) => Promise<void>
}

export const useAppStore = create<AppState>((set) => ({
  lastReply: null,
  lastError: null,
  pinging: false,

  ping: async (message: string) => {
    set({ pinging: true, lastError: null })
    try {
      const res = await ipc.ping(message)
      set({
        lastReply: `${res.reply}  (electron ${res.versions.electron}, node ${res.versions.node}) @ ${res.at}`,
        pinging: false
      })
    } catch (err) {
      set({
        lastError: err instanceof Error ? err.message : String(err),
        pinging: false
      })
    }
  }
}))
