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
}

export function cancelReminder(noteId: string): void {
  saveReminders(loadReminders().filter(r => r.noteId !== noteId))
}

export function getReminder(noteId: string): StoredReminder | undefined {
  return loadReminders().find(r => r.noteId === noteId)
}

export function startReminderChecker(): void {
  // Check immediately on startup (fires anything missed while app was closed)
  checkAndFireReminders()
  setInterval(checkAndFireReminders, 60_000)
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

  if (remaining.length !== reminders.length) saveReminders(remaining)
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
