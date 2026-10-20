// Date helpers for reminders. Reminder times are stored as local wall-clock
// ISO strings with no zone ("2026-04-22T10:00:00"), shared with iOS.

const pad = (n: number) => String(n).padStart(2, '0')

/** "2026-04-22T10:00:00" — the format written into `// @reminder:` lines. */
export function toLocalISOString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}

/** "2026-04-22T10:00" — the value format for <input type="datetime-local">. */
export function toLocalInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function at(base: Date, dayOffset: number, hour: number, minute = 0): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, minute, 0, 0)
  return d
}

export interface QuickOption { label: string; date: Date }

/** Clock-aligned presets, like a typical reminders app. */
export function quickReminderOptions(now = new Date()): QuickOption[] {
  const opts: QuickOption[] = []
  const inHour = new Date(now.getTime() + 3_600_000)
  inHour.setSeconds(0, 0)
  opts.push({ label: 'In 1 hour', date: inHour })

  const later = new Date(now)
  later.setHours(now.getHours() + 3, 0, 0, 0)
  if (later.getDate() === now.getDate() && later.getHours() < 18) {
    opts.push({ label: 'Later today', date: later })
  }
  if (now.getHours() < 17) opts.push({ label: 'This evening', date: at(now, 0, 18) })

  opts.push({ label: 'Tomorrow morning', date: at(now, 1, 9) })

  const daysToMonday = ((8 - now.getDay()) % 7) || 7
  if (daysToMonday > 1 && daysToMonday < 7) opts.push({ label: 'Next Monday', date: at(now, daysToMonday, 9) })

  opts.push({ label: 'In 1 week', date: at(now, 7, 9) })
  return opts
}

export function formatReminderDate(d: Date): string {
  const now = new Date()
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`
  const tomorrow = at(now, 1, 0)
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric', minute: '2-digit',
  })
}

/** "in 2h", "in 3d", "5m ago" */
export function formatRelative(d: Date, now = Date.now()): string {
  const diff = d.getTime() - now
  const abs = Math.abs(diff)
  const mins = Math.round(abs / 60_000)
  let s: string
  if (mins < 1) return diff >= 0 ? 'now' : 'just now'
  if (mins < 60) s = `${mins}m`
  else if (mins < 60 * 24) s = `${Math.round(mins / 60)}h`
  else s = `${Math.round(mins / (60 * 24))}d`
  return diff >= 0 ? `in ${s}` : `${s} ago`
}

export type ReminderGroup = 'Overdue' | 'Today' | 'Tomorrow' | 'This week' | 'Later'

export function reminderGroup(d: Date, now = new Date()): ReminderGroup {
  if (d.getTime() <= now.getTime()) return 'Overdue'
  if (d.toDateString() === now.toDateString()) return 'Today'
  if (d.toDateString() === at(now, 1, 0).toDateString()) return 'Tomorrow'
  if (d.getTime() < at(now, 7, 0).getTime()) return 'This week'
  return 'Later'
}
