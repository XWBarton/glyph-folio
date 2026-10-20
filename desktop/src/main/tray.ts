import { Tray, Menu, nativeImage, NativeImage, app } from 'electron'
import { listReminders, onRemindersChanged, openNoteFromReminder } from './reminders'
import { showMainWindow } from './window'

// Menu bar (macOS) / system tray (Windows, Linux) presence so the app keeps
// running — and reminders keep firing — after the window is closed.

let tray: Tray | null = null
let unsubscribe: (() => void) | null = null
let quitHandler: (() => void) | null = null
let refreshTimer: NodeJS.Timeout | null = null

// ── Icon ──────────────────────────────────────────────────────────────────────
// Rasterised in code (packaging only ships out/**), as a 16pt bell at 2x.

function bellCoverage(x: number, y: number): boolean {
  // Coordinates in a 16×16 design grid
  const dx = x - 8
  if (Math.hypot(dx, y - 2.2) <= 1.1) return true                         // top nub
  if (Math.hypot(dx, y - 13.6) <= 1.6 && y > 13) return true              // clapper
  if (y >= 11 && y <= 12.4 && Math.abs(dx) <= 6.6) return true            // rim
  if (y < 11 && Math.hypot(dx, y - 7) <= 4.6 && y <= 7) return true       // dome
  if (y > 7 && y < 11) {                                                   // flared body
    const half = 4.6 + ((y - 7) / 4) * 1.6
    if (Math.abs(dx) <= half) return true
  }
  return false
}

function buildTrayIcon(): NativeImage {
  const scale = 2
  const size = 16 * scale
  const samples = 4
  const isMac = process.platform === 'darwin'
  // Template images only use alpha on macOS; elsewhere use the app accent.
  const [r, g, b] = isMac ? [0, 0, 0] : [0x25, 0x63, 0xeb]
  const buf = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) / scale
          const y = (py + (sy + 0.5) / samples) / scale
          if (bellCoverage(x, y)) hits++
        }
      }
      const a = hits / (samples * samples)
      const i = (py * size + px) * 4
      // BGRA, premultiplied
      buf[i] = Math.round(b * a)
      buf[i + 1] = Math.round(g * a)
      buf[i + 2] = Math.round(r * a)
      buf[i + 3] = Math.round(255 * a)
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: scale })
  if (isMac) img.setTemplateImage(true)
  return img
}

// ── Menu ──────────────────────────────────────────────────────────────────────

function formatWhen(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return `Today ${time}`
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function rebuildMenu(): void {
  if (!tray) return
  const upcoming = listReminders().filter(r => !r.overdue).slice(0, 5)
  const overdue = listReminders().filter(r => r.overdue && !r.fired).length

  const reminderItems: Electron.MenuItemConstructorOptions[] = upcoming.length
    ? upcoming.map(r => ({
        label: `${truncate(r.noteTitle || 'Untitled', 32)} — ${formatWhen(r.scheduledAt)}`,
        click: () => openNoteFromReminder(r.noteId),
      }))
    : [{ label: 'No upcoming reminders', enabled: false }]

  const menu = Menu.buildFromTemplate([
    { label: 'Open Glyph Folio', click: () => showMainWindow() },
    { type: 'separator' },
    { label: 'Upcoming Reminders', enabled: false },
    ...reminderItems,
    ...(overdue ? [{ label: `${overdue} overdue`, enabled: false }] : []),
    { type: 'separator' },
    { label: 'Quit Glyph Folio', click: () => quitHandler?.() },
  ])
  tray.setContextMenu(menu)

  const next = upcoming[0]
  tray.setToolTip(next ? `Glyph Folio — next: ${next.noteTitle} (${formatWhen(next.scheduledAt)})` : 'Glyph Folio')
}

export function createTray(onQuit: () => void): void {
  if (tray) return
  quitHandler = onQuit
  tray = new Tray(buildTrayIcon())
  // Windows convention: left-click opens the window; the menu is on right-click
  if (process.platform === 'win32') tray.on('click', () => showMainWindow())
  rebuildMenu()
  unsubscribe = onRemindersChanged(rebuildMenu)
  // Relative labels ("Today", "Tomorrow") go stale; refresh periodically
  refreshTimer = setInterval(rebuildMenu, 5 * 60_000)
  // will-quit (not before-quit): before-quit may be cancelled to hide to the tray
  app.once('will-quit', () => destroyTray())
}

export function destroyTray(): void {
  unsubscribe?.()
  unsubscribe = null
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
  tray?.destroy()
  tray = null
}
