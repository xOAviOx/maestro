import { app, BrowserWindow, shell, webContents } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { createEngine, type Engine } from './engine'
import { WorkspaceSupervisor } from './engine/WorkspaceSupervisor'
import { IpcChannels } from '@shared/ipc'
import type { WorkspacePushEvent } from '@shared/types'
import { log } from './log'

// electron-vite injects the renderer dev-server URL in dev; in prod we load the
// bundled file.
const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']

let engine: Engine | null = null
let supervisor: WorkspaceSupervisor | null = null

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    title: 'Maestro',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Security posture (hard constraint): renderer is fully sandboxed from Node.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.on('ready-to-show', () => window.show())

  // In dev, surface renderer console messages (CSP violations, worker errors,
  // React warnings) in the main process log so they're visible in the terminal.
  if (RENDERER_DEV_URL) {
    window.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) log.warn('renderer.console', { level, message, line, sourceId })
    })
  }

  window.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (RENDERER_DEV_URL) {
    void window.loadURL(RENDERER_DEV_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

/** Push a supervisor event to every live renderer. */
function broadcast(evt: WorkspacePushEvent): void {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send(IpcChannels.workspaceEvent, evt)
  }
}

app.whenReady().then(() => {
  // Engine + supervisor live for the app's lifetime.
  engine = createEngine()
  supervisor = new WorkspaceSupervisor(engine)
  supervisor.subscribe(broadcast)

  registerIpcHandlers({ engine, supervisor })

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })

  log.info('app.ready')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // Stop any in-flight agent runs and close the DB cleanly.
  supervisor?.cancelAll()
  engine?.close()
})
