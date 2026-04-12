import { app, BrowserWindow, shell, nativeImage } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { buildMenu } from './menu'
import { startWatcher, stopWatcher, seedDefaultNotes } from './notesManager'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  const isLinux = process.platform === 'linux'

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 700,
    minHeight: 500,
    titleBarStyle: isMac ? 'hiddenInset' : (isLinux ? 'default' : 'hidden'),
    ...(isMac && {
      vibrancy: 'under-window',
      visualEffectState: 'active',
      transparent: true,
      backgroundColor: '#00000000'
    }),
    ...(!isMac && {
      backgroundColor: '#f0f4ff'
    }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    stopWatcher()
    mainWindow = null
  })

  const sendFullscreen = (isFullscreen: boolean) => {
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('window:fullscreen', isFullscreen)
    }
  }
  mainWindow.on('enter-full-screen', () => sendFullscreen(true))
  mainWindow.on('leave-full-screen', () => sendFullscreen(false))
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    const bases = [app.getAppPath(), join(__dirname, '..', '..')]
    const names = ['resources/icon.png', 'resources/icon.icns']
    outer: for (const base of bases) {
      for (const name of names) {
        const icon = nativeImage.createFromPath(join(base, name))
        if (!icon.isEmpty()) { app.dock.setIcon(icon); break outer }
      }
    }
  }

  seedDefaultNotes()
  registerIpcHandlers()
  createWindow()
  buildMenu(mainWindow)

  // Start file watcher — sends 'notes:changed' to renderer when .typ files change
  startWatcher((event, filePath) => {
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('notes:changed', event, filePath)
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      buildMenu(mainWindow)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
