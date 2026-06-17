/// <reference types="vite/client" />

import type { MaestroApi } from '@shared/ipc'

/**
 * Makes `window.maestro` (exposed by the preload via contextBridge) fully
 * typed throughout the React renderer.
 */
declare global {
  interface Window {
    maestro: MaestroApi
  }
}

export {}
