import { Menu, BrowserWindow, app } from 'electron'
import { getMainWindow } from './window'

/** Menu commands act on whichever window is in front (there can be several). */
function send(channel: string): void {
  const win = BrowserWindow.getFocusedWindow() ?? getMainWindow()
  win?.webContents.send(channel)
}

/**
 * Windows' titleBarOverlay replaces the classic menu bar row entirely, so the
 * app menu (Import, Export, etc.) has no persistent on-screen entry point —
 * only the undiscoverable Alt-key fallback. The toolbar's menu button calls
 * this to open it as a popup instead.
 */
export function popupMenu(win: BrowserWindow): void {
  Menu.getApplicationMenu()?.popup({ window: win })
}

export function buildMenu(opts: { onQuit: () => void; onNewWindow: () => void }): void {
  // Custom Quit so Cmd/Ctrl+Q can hide to the menu bar instead of stopping
  // reminders. System quits (logout, dock Quit, tray Quit) bypass this.
  const quitItem: Electron.MenuItemConstructorOptions = {
    label: process.platform === 'darwin' ? `Quit ${app.name}` : 'Quit',
    accelerator: 'CmdOrCtrl+Q',
    click: () => opts.onQuit(),
  }

  const appMenu: Electron.MenuItemConstructorOptions[] = process.platform !== 'darwin' ? [] : [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        quitItem
      ]
    }
  ]

  const template: Electron.MenuItemConstructorOptions[] = [
    ...appMenu,
    {
      label: 'Note',
      submenu: [
        {
          label: 'New Note',
          accelerator: 'CmdOrCtrl+N',
          click: () => send('menu:new')
        },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => opts.onNewWindow()
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => send('menu:close-tab')
        },
        {
          label: 'Delete Note',
          click: () => send('menu:delete')
        },
        { type: 'separator' },
        {
          label: 'Export PDF',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => send('menu:export-pdf')
        },
        {
          label: 'Export Word (.docx)',
          click: () => send('menu:export-docx')
        },
        {
          label: 'Share Source…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send('menu:share-source')
        },
        {
          label: 'Import…',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => send('menu:import')
        },
        ...(process.platform !== 'darwin' ? [
          { type: 'separator' as const },
          quitItem
        ] : [])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Dictionary…',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => send('menu:dictionary')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reminders',
          accelerator: 'CmdOrCtrl+Alt+R',
          click: () => send('menu:reminders')
        },
        { type: 'separator' },
        {
          label: 'Rerender PDF',
          accelerator: 'CmdOrCtrl+R',
          click: () => send('menu:rerender')
        },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin' ? [
          { type: 'separator' as const },
          { role: 'front' as const }
        ] : [])
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
