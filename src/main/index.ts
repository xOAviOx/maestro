import { app, BrowserWindow, safeStorage, shell, webContents } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import {
  createEngine,
  EngineTaskRunner,
  WorkflowScheduler,
  type Engine,
  type SecretCipher
} from './engine'
import { WorkspaceSupervisor } from './engine/WorkspaceSupervisor'
import { PtyManager } from './terminal/PtyManager'
import { IpcChannels } from '@shared/ipc'
import type { Workflow, WorkspacePushEvent } from '@shared/types'
import { log } from './log'

// electron-vite injects the renderer dev-server URL in dev; in prod we load the
// bundled file.
const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']

let engine: Engine | null = null
let supervisor: WorkspaceSupervisor | null = null
let scheduler: WorkflowScheduler | null = null
let ptyManager: PtyManager | null = null

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

/** Send a payload to every live renderer. */
function sendToAll(channel: string, payload: unknown): void {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send(channel, payload)
  }
}

/** Push a supervisor event to every live renderer. */
function broadcast(evt: WorkspacePushEvent): void {
  sendToAll(IpcChannels.workspaceEvent, evt)
}

/** Push a workflow snapshot to every live renderer. */
function broadcastWorkflow(workflow: Workflow): void {
  sendToAll(IpcChannels.workflowEvent, { type: 'workflow_updated', workflow })
}

/**
 * OS-keychain-backed cipher for stored credentials, via Electron safeStorage.
 * Encryption is unavailable until the app is ready and on some Linux setups
 * without a configured keyring; the CredentialStore refuses to persist plaintext
 * when isAvailable() is false.
 */
function electronCipher(): SecretCipher {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plaintext) => safeStorage.encryptString(plaintext),
    decrypt: (ciphertext) => safeStorage.decryptString(ciphertext)
  }
}

app.whenReady().then(() => {
  // Engine + supervisor + scheduler live for the app's lifetime.
  engine = createEngine({ cipher: electronCipher() })
  supervisor = new WorkspaceSupervisor(engine)

  const runner = new EngineTaskRunner(engine, supervisor)
  scheduler = new WorkflowScheduler({
    store: engine.workflows,
    runner,
    emit: broadcastWorkflow,
    resolveBaseBranch: (repoPath) => engine!.git.getDefaultBaseBranch(repoPath)
  })

  // A single supervisor subscription both broadcasts to the renderer AND drives
  // the DAG scheduler: a task's agent finishing/erroring advances its task. The
  // scheduler ignores workspace ids it doesn't own (manual, non-workflow runs).
  supervisor.subscribe((evt) => {
    broadcast(evt)
    if (evt.type === 'status_changed') {
      if (evt.status === 'awaiting_input') scheduler!.onAgentCompleted(evt.workspaceId)
      else if (evt.status === 'error') scheduler!.onAgentFailed(evt.workspaceId, 'agent error')
    }
  })

  // App restart recovery: mark interrupted (previously-running) tasks failed.
  scheduler.recover()

  ptyManager = new PtyManager(
    (e) => sendToAll(IpcChannels.terminalData, e),
    (e) => sendToAll(IpcChannels.terminalExit, e)
  )

  registerIpcHandlers({ engine, supervisor, scheduler, ptyManager })

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
  // Stop any in-flight agent runs, kill shells, and close the DB cleanly.
  supervisor?.cancelAll()
  ptyManager?.disposeAll()
  engine?.close()
})
