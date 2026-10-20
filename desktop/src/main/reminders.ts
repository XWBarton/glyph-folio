import { Notification, app, powerMonitor } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { listNotes, readNote, extractTitle } from './notesManager'
import { showMainWindow, sendToRenderer } from './window'

// ── Model ─────────────────────────────────────────────────────────────────────
// The note body is the single source of truth: a `// @reminder: <local ISO>`
// line. We keep an in-memory index built from the notes on disk, and persist
// only a "fired" log ({ noteId: scheduledAt }) so a reminder fires exactly
// once per scheduled time — re-saving the note never re-fires it, but moving
// the time re-arms it.

interface IndexedReminder {
  noteId: string
  noteTitle: string
  scheduledAt: string  // local ISO 8601: "2026-04-22T10:00:00"
  preview: string
}

export interface ReminderInfo {
  noteId: string
  noteTitle: string
  scheduledAt: string
  fired: boolean
  overdue: boolean
}

const REMINDER_RE = /^\/\/\s*@reminder:\s*(.+)$/m
const MISSED_GRACE_MS = 2 * 60_000            // later than this counts as "missed"
const MISSED_ALERT_WINDOW_MS = 24 * 3_600_000 // older than this: mark fired silently

const index = new Map<string, IndexedReminder>()
let firedLog: Record<string, string> = {}
const listeners = new Set<() => void>()

/** Parse the reminder line from a note body. Returns the normalised local ISO string, or null. */
export function parseReminder(body: string): string | null {
  const match = body.match(REMINDER_RE)
  if (!match) return null
  const raw = match[1].trim()
  // Accept "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss" (no zone = local time)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(raw)) return null
  const t = new Date(raw).getTime()
  if (!Number.isFinite(t)) return null
  return raw.length === 16 ? `${raw}:00` : raw
}

function timeOf(r: { scheduledAt: string }): number {
  return new Date(r.scheduledAt).getTime()
}

/** First line of real content, for the notification body. */
function extractPreview(body: string): string {
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('//') || line.startsWith('#') || /^={1,6}\s/.test(line)) continue
    const clean = line.replace(/^[-+*]\s+|^\d+\.\s+/, '').replace(/[*_`$]/g, '').trim()
    if (clean) return clean.length > 120 ? clean.slice(0, 117) + '…' : clean
  }
  return ''
}

// ── Fired log persistence ─────────────────────────────────────────────────────

function getFiredLogPath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'reminders-fired.json')
}

function loadFiredLog(): void {
  try {
    const p = getFiredLogPath()
    if (existsSync(p)) firedLog = JSON.parse(readFileSync(p, 'utf8')) as Record<string, string>
  } catch {
    firedLog = {}
  }
}

function saveFiredLog(): void {
  try { writeFileSync(getFiredLogPath(), JSON.stringify(firedLog, null, 2), 'utf8') } catch {}
}

function isFired(r: IndexedReminder): boolean {
  return firedLog[r.noteId] === r.scheduledAt
}

// ── Index maintenance ─────────────────────────────────────────────────────────

/** Rescan every note on disk. Called at startup and when the notes folder changes. */
export async function rebuildReminderIndex(): Promise<void> {
  index.clear()
  try {
    const metas = await listNotes()
    for (const meta of metas) {
      const note = readNote(meta.filePath)
      if (note) indexNote(note.id, note.body)
    }
  } catch (e) {
    console.error('[GlyphFolio Reminder] Failed to scan notes:', e)
  }
  // Drop fired entries for notes that no longer exist or no longer have a reminder
  let pruned = false
  for (const id of Object.keys(firedLog)) {
    if (!index.has(id)) { delete firedLog[id]; pruned = true }
  }
  if (pruned) saveFiredLog()
  onIndexChanged()
}

function indexNote(noteId: string, body: string): boolean {
  const scheduledAt = parseReminder(body)
  const prev = index.get(noteId)
  if (!scheduledAt) {
    return index.delete(noteId)
  }
  const next: IndexedReminder = {
    noteId,
    noteTitle: extractTitle(body, noteId),
    scheduledAt,
    preview: extractPreview(body),
  }
  index.set(noteId, next)
  return !prev || prev.scheduledAt !== next.scheduledAt || prev.noteTitle !== next.noteTitle
}

/** Update a single note's reminder from its body (null body = note deleted). */
export function updateReminderForNote(noteId: string, body: string | null): void {
  const changed = body === null ? index.delete(noteId) : indexNote(noteId, body)
  if (body === null && firedLog[noteId]) { delete firedLog[noteId]; saveFiredLog() }
  if (changed) onIndexChanged()
}

function onIndexChanged(): void {
  rescheduleNext()
  sendToRenderer('reminders:changed')
  for (const l of listeners) l()
}

export function onRemindersChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function listReminders(): ReminderInfo[] {
  const now = Date.now()
  return [...index.values()]
    .map(r => ({
      noteId: r.noteId,
      noteTitle: r.noteTitle,
      scheduledAt: r.scheduledAt,
      fired: isFired(r),
      overdue: timeOf(r) <= now,
    }))
    .sort((a, b) => timeOf(a) - timeOf(b))
}

// ── Scheduling ────────────────────────────────────────────────────────────────
// A precise setTimeout to the next due reminder, plus a coarse safety-net
// interval and wake/unlock hooks, so timer drift or system sleep can't leave a
// reminder unfired.

let nextTimer: NodeJS.Timeout | null = null
const SAFETY_POLL_MS = 30_000
const MAX_TIMEOUT_MS = 2_147_483_647  // setTimeout max (~24.8 days)

export async function startReminderChecker(): Promise<void> {
  loadFiredLog()
  await rebuildReminderIndex()
  checkAndFireReminders()
  setInterval(checkAndFireReminders, SAFETY_POLL_MS)
  powerMonitor.on('resume', checkAndFireReminders)
  powerMonitor.on('unlock-screen', checkAndFireReminders)
}

function rescheduleNext(): void {
  if (nextTimer) { clearTimeout(nextTimer); nextTimer = null }
  const now = Date.now()
  let nextDue = Infinity
  for (const r of index.values()) {
    if (isFired(r)) continue
    const t = timeOf(r)
    if (t <= now) { setImmediate(checkAndFireReminders); return }
    if (t < nextDue) nextDue = t
  }
  if (nextDue === Infinity) return
  const delay = Math.min(nextDue - now, MAX_TIMEOUT_MS)
  nextTimer = setTimeout(() => { nextTimer = null; checkAndFireReminders() }, delay)
}

function checkAndFireReminders(): void {
  const now = Date.now()
  let changed = false
  for (const r of index.values()) {
    if (isFired(r)) continue
    const t = timeOf(r)
    if (t > now) continue
    // Record before notifying so a crash mid-notification can't cause a repeat
    firedLog[r.noteId] = r.scheduledAt
    changed = true
    const lateBy = now - t
    if (lateBy > MISSED_ALERT_WINDOW_MS) continue  // too stale to alert; still listed as overdue
    fireNotification(r, lateBy > MISSED_GRACE_MS)
  }
  if (changed) {
    saveFiredLog()
    onIndexChanged()
  }
}

// Electron notifications must stay referenced or their click handlers can be
// garbage-collected before the user interacts with them.
const liveNotifications = new Set<Notification>()

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function fireNotification(r: IndexedReminder, missed: boolean): void {
  console.log('[GlyphFolio Reminder] Firing notification:', r.noteTitle, r.scheduledAt)
  if (!Notification.isSupported()) {
    console.warn('[GlyphFolio Reminder] Notifications not supported on this system')
    return
  }
  try {
    const when = missed ? `Missed reminder · ${formatTime(r.scheduledAt)}` : `Reminder · ${formatTime(r.scheduledAt)}`
    const n = new Notification({
      title: r.noteTitle || 'Note Reminder',
      body: r.preview ? `${when}\n${r.preview}` : when,
      urgency: 'critical',
      timeoutType: 'never',
    })
    liveNotifications.add(n)
    const release = () => liveNotifications.delete(n)
    n.on('click', () => {
      release()
      openNoteFromReminder(r.noteId)
    })
    n.on('close', release)
    n.on('failed', (_, err) => {
      release()
      console.error('[GlyphFolio Reminder] Notification failed:', err)
    })
    n.show()
  } catch (e) {
    console.error('[GlyphFolio Reminder] Error showing notification:', e)
  }
}

/** Bring the window forward and ask the renderer to open a note. */
export function openNoteFromReminder(noteId: string): void {
  showMainWindow()
  sendToRenderer('reminder:open', noteId)
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
