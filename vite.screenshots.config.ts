import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Standalone web build of the *real* renderer for deterministic screenshots.
 *
 * The renderer is a "dumb" React app that only ever talks to `window.maestro`,
 * so we can serve it as an ordinary Vite web app (no Electron, no better-sqlite3
 * / node-pty native rebuilds) and mount it against a mock IPC bridge seeded with
 * realistic fixtures. `screenshots/entry.tsx` installs that mock before importing
 * the app. Same aliases as electron.vite.config.ts so imports resolve identically.
 */
export default defineConfig({
  root: resolve(__dirname, 'screenshots'),
  // Serve renderer static assets (xterm/monaco css, etc.) from repo root.
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@renderer': resolve(__dirname, 'src/renderer')
    }
  },
  plugins: [react()],
  server: { port: 5199, strictPort: true },
  // Monaco ships large worker chunks; silence the size warning for this dev-only build.
  build: { chunkSizeWarningLimit: 4000 }
})
