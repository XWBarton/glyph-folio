import { useEffect, useState } from 'react'
import type { ReminderInfo } from '../../../preload/index'

/** Live list of every note reminder, kept in sync with the main-process index. */
export function useReminders(): ReminderInfo[] {
  const [reminders, setReminders] = useState<ReminderInfo[]>([])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      window.api.reminderList().then(list => { if (!cancelled) setReminders(list) })
    }
    load()
    const unsub = window.api.onRemindersChanged(load)
    // `overdue` is computed at list time — refresh so items roll over on time
    const id = setInterval(load, 60_000)
    return () => { cancelled = true; unsub(); clearInterval(id) }
  }, [])

  return reminders
}
