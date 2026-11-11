import { app, BrowserWindow, shell, nativeImage } from 'electron'
import { join, basename, extname } from 'path'
import { registerIpcHandlers } from './ipc'
import { buildMenu } from './menu'
import { startWatcher, restartWatcher, seedDefaultNotes, readNote } from './notesManager'
import { startReminderChecker, rebuildReminderIndex, updateReminderForNote } from './reminders'
import { getStore } from './store'
import { createTray, destroyTray } from './tray'
import { setMainWindow, registerWindowFactory, registerNoteWindowFactory, showMainWindow, broadcast } from './window'

let mainWindow: BrowserWindow | null = null
// Set when the user really wants to quit (tray Quit, dock Quit, logout) so the
// window's close handler stops hiding it.
let isQuitting = false

const runInBackground = (): boolean => getStore().get('runInBackground')

function buildWindow(options: { show?: boolean; query?: Record<string, string>; bounds?: Partial<Electron.Rectangle> } = {}): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const isLinux = process.platform === 'linux'

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    ...options.bounds,
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
    // Windows: hidden title bar + native min/max/close drawn over the toolbar
    ...(process.platform === 'win32' && {
      titleBarOverlay: { color: '#f6f8ff', symbolColor: '#6b7280', height: 48 }
    }),
    show: options.show ?? true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  const query = options.query ?? {}
  if (process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    win.loadURL(url.toString())
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }

  const sendFullscreen = (isFullscreen: boolean) => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('window:fullscreen', isFullscreen)
    }
  }
  win.on('enter-full-screen', () => sendFullscreen(true))
  win.on('leave-full-screen', () => sendFullscreen(false))

  return win
}

function createWindow(options: { show?: boolean } = {}): BrowserWindow {
  mainWindow = buildWindow({ show: options.show })

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

  setMainWindow(mainWindow)
  return mainWindow
}

/** Extra window (File → New Window / tab "Open in New Window"). Closes for real. */
function createNoteWindow(noteId?: string): BrowserWindow {
  // Cascade from whichever window is in front so the new one doesn't sit exactly on top
  const anchor = BrowserWindow.getFocusedWindow() ?? mainWindow
  const bounds = anchor && !anchor.isDestroyed() && !anchor.isFullScreen()
    ? (({ x, y, width, height }) => ({ x: x + 28, y: y + 28, width, height }))(anchor.getBounds())
    : undefined
  const query: Record<string, string> = { window: 'secondary' }
  if (noteId) query.note = noteId
  return buildWindow({ query, bounds })
}

/** Extra windows don't run in the background — close them when hiding to the tray. */
function closeSecondaryWindows(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win !== mainWindow) win.close()
  }
}

/** App-menu Quit / Cmd+Q: hide to the menu bar when running in background. */
function requestQuit(): void {
  if (runInBackground()) {
    closeSecondaryWindows()
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
  broadcast('notes:changed', event, filePath)
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
  registerNoteWindowFactory(createNoteWindow)
  buildMenu({ onQuit: requestQuit, onNewWindow: () => createNoteWindow() })
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
