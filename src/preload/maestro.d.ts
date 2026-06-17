import type { MaestroApi } from '@shared/ipc'

/**
 * Augments the renderer's global scope so `window.maestro` is fully typed
 * everywhere in the React app. Kept alongside the preload that defines the
 * actual bridge, and included by the web tsconfig via the shared glob.
 */
declare global {
  interface Window {
    maestro: MaestroApi
  }
}

export {}
