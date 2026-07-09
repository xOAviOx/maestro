/**
 * Screenshot-harness entry point.
 *
 * Installs a mock `window.maestro` (seeded with realistic fixtures) BEFORE the
 * real renderer is imported, then mounts the actual <App/>. Scenes — one per
 * feature — drive the live Zustand store and emit synthetic push events to put
 * each screen into its "working" state. The Playwright driver calls
 * `window.__scenes[name]()` then screenshots.
 *
 * Nothing here is shipped in the Electron app; it exists only to render the real
 * UI in a browser for capture.
 */
import { installMockMaestro } from './mock-maestro'

// Must run before importing the app so the store's init() sees the bridge.
const bridge = installMockMaestro()

async function main(): Promise<void> {
  const React = (await import('react')).default
  const ReactDOM = await import('react-dom/client')
  await import('@xyflow/react/dist/style.css')
  await import('../src/renderer/index.css')
  const App = (await import('../src/renderer/App')).default
  const { useStore } = await import('../src/renderer/store')
  const { registerScenes } = await import('./scenes')

  const rootEl = document.getElementById('root')
  if (!rootEl) throw new Error('#root not found')

  ReactDOM.createRoot(rootEl).render(React.createElement(App))

  // Expose the scene registry + store for the Playwright driver.
  const scenes = registerScenes({ store: useStore, bridge })
  ;(window as unknown as { __scenes: typeof scenes }).__scenes = scenes
  ;(window as unknown as { __ready: boolean }).__ready = true
}

void main()
