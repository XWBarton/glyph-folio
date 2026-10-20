import { app, BrowserWindow, shell, nativeImage } from 'electron'
import { join, basename, extname } from 'path'
import { registerIpcHandlers } from './ipc'
import { buildMenu } from './menu'
import { startWatcher, restartWatcher, seedDefaultNotes, readNote } from './notesManager'
import { startReminderChecker, rebuildReminderIndex, updateReminderForNote } from './reminders'
import { getStore } from './store'
import { createTray, destroyTray } from './tray'
import { setMainWindow, registerWindowFactory, showMainWindow } from './window'

let mainWindow: BrowserWindow | null = null
// Set when the user really wants to quit (tray Quit, dock Quit, logout) so the
// window's close handler stops hiding it.
let isQuitting = false

const runInBackground = (): boolean => getStore().get('runInBackground')

function createWindow(options: { show?: boolean } = {}): BrowserWindow {
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
    show: options.show ?? true,
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

  // Hide rather than destroy, so the renderer (and its server sync) stays
  // alive in the background and reminders from other devices still arrive.
  mainWindow.on('close', (e) => {
    if (!isQuitting && runInBackground()) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    setMainWindow(null)
  })

  const sendFullscreen = (isFullscreen: boolean) => {
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('window:fullscreen', isFullscreen)
    }
  }
  mainWindow.on('enter-full-screen', () => sendFullscreen(true))
  mainWindow.on('leave-full-screen', () => sendFullscreen(false))

  setMainWindow(mainWindow)
  buildMenu(mainWindow, { onQuit: requestQuit })
  return mainWindow
}

/** App-menu Quit / Cmd+Q: hide to the menu bar when running in background. */
function requestQuit(): void {
  if (runInBackground()) {
    mainWindow?.hide()
    if (process.platform === 'darwin') app.hide()
  } else {
    quitForReal()
  }
}

function quitForReal(): void {
  isQuitting = true
  app.quit()
}

/** Forward watcher events to the renderer and keep the reminder index current. */
function handleNoteFileEvent(event: 'add' | 'change' | 'unlink', filePath: string): void {
  if (extname(filePath) === '.typ') {
    const noteId = basename(filePath, '.typ')
    updateReminderForNote(noteId, event === 'unlink' ? null : (readNote(filePath)?.body ?? null))
  }
  if (mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('notes:changed', event, filePath)
  }
}

function applyBackgroundSettings(): void {
  const store = getStore()
  if (store.get('runInBackground')) createTray(quitForReal)
  else destroyTray()
  // Skip in dev, where it would register the bare Electron binary
  if (app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32')) {
    app.setLoginItemSettings({
      openAtLogin: store.get('openAtLogin'),
      openAsHidden: true,   // macOS < 13
      args: ['--hidden'],   // Windows
    })
  }
}

function launchedHidden(): boolean {
  if (process.argv.includes('--hidden')) return true
  if (process.platform === 'darwin') {
    const s = app.getLoginItemSettings()
    return Boolean(s.wasOpenedAsHidden)
  }
  return false
}

// Needed for Windows toast notifications to group correctly; harmless elsewhere.
if (process.platform === 'win32') app.setAppUserModelId('com.glyph.folio')

// One instance only — a second copy (e.g. launched at login and again by
// hand) would run its own scheduler and fire every reminder twice.
const gotInstanceLock = app.requestSingleInstanceLock()
if (!gotInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => { showMainWindow() })
}

app.on('before-quit', () => { isQuitting = true })

app.whenReady().then(() => {
  if (!gotInstanceLock) return
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
  registerIpcHandlers({
    onNotesDirChanged: () => {
      restartWatcher(handleNoteFileEvent)
      rebuildReminderIndex()
    },
    onBackgroundSettingsChanged: applyBackgroundSettings,
  })
  registerWindowFactory(() => createWindow())
  createWindow({ show: !launchedHidden() })
  startReminderChecker()
  applyBackgroundSettings()

  // App-level file watcher (outlives the window): sends 'notes:changed' to the
  // renderer and keeps reminders in sync with external edits / iCloud.
  startWatcher(handleNoteFileEvent)

  app.on('activate', () => { showMainWindow() })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !runInBackground()) app.quit()
})
