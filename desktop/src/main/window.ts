import { BrowserWindow } from 'electron'

// Shared handle to the main window so background modules (reminders, tray)
// can reach it without importing index.ts.

let mainWindow: BrowserWindow | null = null
let createWindowFn: (() => BrowserWindow) | null = null
let createNoteWindowFn: ((noteId?: string) => BrowserWindow) | null = null

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function registerWindowFactory(fn: () => BrowserWindow): void {
  createWindowFn = fn
}

export function registerNoteWindowFactory(fn: (noteId?: string) => BrowserWindow): void {
  createNoteWindowFn = fn
}

/** Open an extra window, optionally starting on a given note. */
export function openNoteWindow(noteId?: string): BrowserWindow | null {
  return createNoteWindowFn ? createNoteWindowFn(noteId) : null
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

function sendTo(win: BrowserWindow, channel: string, args: unknown[]): void {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => win.webContents.send(channel, ...args))
  } else {
    win.webContents.send(channel, ...args)
  }
}

/** Send to the main window's renderer, waiting for the page to finish loading if needed. */
export function sendToRenderer(channel: string, ...args: unknown[]): void {
  const win = getMainWindow()
  if (win) sendTo(win, channel, args)
}

/** Send to every open window (main + extra note windows). */
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) sendTo(win, channel, args)
}
