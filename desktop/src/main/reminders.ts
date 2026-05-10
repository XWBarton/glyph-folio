import { Notification, app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

interface StoredReminder {
  noteId: string
  noteTitle: string
  scheduledAt: string  // local ISO 8601: "2026-04-22T10:00:00"
}

function getRemindersPath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'reminders.json')
}

function loadReminders(): StoredReminder[] {
  try {
    const p = getRemindersPath()
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) as StoredReminder[]
  } catch {}
  return []
}

function saveReminders(reminders: StoredReminder[]): void {
  try { writeFileSync(getRemindersPath(), JSON.stringify(reminders, null, 2), 'utf8') } catch {}
}

export function setReminder(noteId: string, noteTitle: string, scheduledAt: string): void {
  const reminders = loadReminders().filter(r => r.noteId !== noteId)
  reminders.push({ noteId, noteTitle, scheduledAt })
  saveReminders(reminders)
  rescheduleNext()
}

export function cancelReminder(noteId: string): void {
  saveReminders(loadReminders().filter(r => r.noteId !== noteId))
  rescheduleNext()
}

export function getReminder(noteId: string): StoredReminder | undefined {
  return loadReminders().find(r => r.noteId === noteId)
}

// ── Scheduling ────────────────────────────────────────────────────────────────
// We combine a precise setTimeout to the next due reminder with a coarse
// safety-net interval (every 30s) so drift, system sleep, or file-watcher
// race conditions can't leave a reminder unfired.

let nextTimer: NodeJS.Timeout | null = null
const SAFETY_POLL_MS = 30_000
const MAX_TIMEOUT_MS = 2_147_483_647  // setTimeout max (~24.8 days)

export function startReminderChecker(): void {
  checkAndFireReminders()
  setInterval(checkAndFireReminders, SAFETY_POLL_MS)
  rescheduleNext()
}

/** Re-arm the precise setTimeout for the soonest pending reminder. */
export function rescheduleNext(): void {
  if (nextTimer) { clearTimeout(nextTimer); nextTimer = null }
  const reminders = loadReminders()
  if (reminders.length === 0) return
  const now = Date.now()
  const nextDue = reminders
    .map(r => new Date(r.scheduledAt).getTime())
    .filter(t => Number.isFinite(t) && t > now)
    .sort((a, b) => a - b)[0]
  if (!nextDue) { checkAndFireReminders(); return }  // something's already past due
  const delay = Math.min(nextDue - now, MAX_TIMEOUT_MS)
  nextTimer = setTimeout(() => { nextTimer = null; checkAndFireReminders() }, delay)
}

function checkAndFireReminders(): void {
  const now = Date.now()
  const reminders = loadReminders()
  if (reminders.length === 0) return

  const remaining: StoredReminder[] = []
  for (const r of reminders) {
    if (new Date(r.scheduledAt).getTime() <= now) {
      fireNotification(r)
    } else {
      remaining.push(r)
    }
  }

  if (remaining.length !== reminders.length) {
    saveReminders(remaining)
    rescheduleNext()
  }
}

function fireNotification(r: StoredReminder): void {
  console.log('[GlyphFolio Reminder] Firing notification:', r.noteTitle, r.scheduledAt)
  if (!Notification.isSupported()) {
    console.warn('[GlyphFolio Reminder] Notifications not supported on this system')
    return
  }
  try {
    const n = new Notification({
      title: r.noteTitle || 'Note Reminder',
      body: `Reminder: "${r.noteTitle || 'a note'}"`,
      urgency: 'normal',
    })
    n.on('show', () => console.log('[GlyphFolio Reminder] Notification shown'))
    n.on('failed', (_, err) => console.error('[GlyphFolio Reminder] Notification failed:', err))
    n.show()
  } catch (e) {
    console.error('[GlyphFolio Reminder] Error showing notification:', e)
  }
}

export interface NotificationTestResult {
  supported: boolean
  shown: boolean
  error?: string
}

/** Fire a test notification and report whether the OS accepted it. Used by the settings UI. */
export function testNotification(): Promise<NotificationTestResult> {
  if (!Notification.isSupported()) {
    return Promise.resolve({ supported: false, shown: false, error: 'Notifications not supported on this system' })
  }
  return new Promise<NotificationTestResult>((resolve) => {
    let settled = false
    const done = (result: NotificationTestResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    try {
      const n = new Notification({
        title: 'Glyph Folio',
        body: 'Test notification — if you see this, reminders will work.',
        urgency: 'normal',
      })
      n.on('show', () => done({ supported: true, shown: true }))
      n.on('failed', (_, err) =>
        done({ supported: true, shown: false, error: String(err ?? 'unknown failure') }))
      n.show()
      // Fallback — if neither event fires within 1.5s, assume shown (Electron
      // emits 'show' on most platforms, but macOS can skip it if delivered to
      // Notification Center silently).
      setTimeout(() => done({ supported: true, shown: true }), 1500)
    } catch (e) {
      done({ supported: true, shown: false, error: String(e) })
    }
  })
}
