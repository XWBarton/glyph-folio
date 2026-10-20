import { BrowserWindow } from 'electron'

// Shared handle to the main window so background modules (reminders, tray)
// can reach it without importing index.ts.

let mainWindow: BrowserWindow | null = null
let createWindowFn: (() => BrowserWindow) | null = null

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function registerWindowFactory(fn: () => BrowserWindow): void {
  createWindowFn = fn
}

/** Show + focus the main window, recreating it if it was destroyed. */
export function showMainWindow(): BrowserWindow | null {
  let win = getMainWindow()
  if (!win && createWindowFn) win = createWindowFn()
  if (!win) return null
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return win
}

/** Send to the renderer, waiting for the page to finish loading if needed. */
export function sendToRenderer(channel: string, ...args: unknown[]): void {
  const win = getMainWindow()
  if (!win || win.webContents.isDestroyed()) return
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => win.webContents.send(channel, ...args))
  } else {
    win.webContents.send(channel, ...args)
  }
}
