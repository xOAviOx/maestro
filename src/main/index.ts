import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'

// electron-vite injects these at build time. Renderer dev server URL in dev,
// bundled file in production.
const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']

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
      // Security posture (hard constraint): renderer is fully sandboxed from
      // Node. It may only talk to main via the contextBridge preload API.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  // Open target=_blank / external links in the OS browser, never in-app.
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

app.whenReady().then(() => {
  // Register all IPC handlers once, before any window can call them.
  registerIpcHandlers()

  createMainWindow()

  app.on('activate', () => {
    // macOS: re-create a window when the dock icon is clicked and none are open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // Quit on Windows/Linux; stay resident on macOS until Cmd+Q.
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
