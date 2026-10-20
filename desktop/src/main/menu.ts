import { Menu, BrowserWindow, app } from 'electron'

export function buildMenu(win: BrowserWindow | null, opts: { onQuit: () => void }): void {
  // Custom Quit so Cmd/Ctrl+Q can hide to the menu bar instead of stopping
  // reminders. System quits (logout, dock Quit, tray Quit) bypass this.
  const quitItem: Electron.MenuItemConstructorOptions = {
    label: process.platform === 'darwin' ? `Quit ${app.name}` : 'Quit',
    accelerator: 'CmdOrCtrl+Q',
    click: () => opts.onQuit(),
  }

  const template: Electron.MenuItemConstructorOptions[] = [
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
    },
    {
      label: 'Note',
      submenu: [
        {
          label: 'New Note',
          accelerator: 'CmdOrCtrl+N',
          click: () => win?.webContents.send('menu:new')
        },
        {
          label: 'Delete Note',
          click: () => win?.webContents.send('menu:delete')
        },
        { type: 'separator' },
        {
          label: 'Export PDF',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => win?.webContents.send('menu:export-pdf')
        },
        {
          label: 'Export Word (.docx)',
          click: () => win?.webContents.send('menu:export-docx')
        },
        {
          label: 'Share Source…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => win?.webContents.send('menu:share-source')
        },
        {
          label: 'Import…',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => win?.webContents.send('menu:import')
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
          click: () => win?.webContents.send('menu:dictionary')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reminders',
          accelerator: 'CmdOrCtrl+Alt+R',
          click: () => win?.webContents.send('menu:reminders')
        },
        { type: 'separator' },
        {
          label: 'Rerender PDF',
          accelerator: 'CmdOrCtrl+R',
          click: () => win?.webContents.send('menu:rerender')
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
