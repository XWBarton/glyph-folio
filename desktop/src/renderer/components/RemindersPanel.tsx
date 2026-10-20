import React, { useEffect, useState } from 'react'
import type { ReminderInfo } from '../../../preload/index'
import { ReminderPicker } from './ReminderPicker'
import { formatReminderDate, formatRelative, reminderGroup, type ReminderGroup } from '../lib/reminderTime'

interface Props {
  open: boolean
  reminders: ReminderInfo[]
  onClose: () => void
  onOpenNote: (noteId: string) => void
  /** Set (date) or clear (null) a note's reminder. */
  onUpdate: (noteId: string, date: Date | null) => Promise<void>
}

const GROUP_ORDER: ReminderGroup[] = ['Overdue', 'Today', 'Tomorrow', 'This week', 'Later']

export function RemindersPanel({ open, reminders, onClose, onOpenNote, onUpdate }: Props) {
  const [editing, setEditing] = useState<ReminderInfo | null>(null)
  const [, tick] = React.useReducer(x => x + 1, 0)

  // Keep relative labels ("in 5m") fresh while open
  useEffect(() => {
    if (!open) return
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [open])

  useEffect(() => { if (!open) setEditing(null) }, [open])

  // Esc closes the panel (the picker handles its own Esc while editing)
  useEffect(() => {
    if (!open || editing) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, editing, onClose])

  if (!open) return null

  const now = new Date()
  const groups = new Map<ReminderGroup, ReminderInfo[]>()
  for (const r of reminders) {
    const g = reminderGroup(new Date(r.scheduledAt), now)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(r)
  }
  // Overdue reads most-recent first; everything else soonest first
  groups.get('Overdue')?.reverse()

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15, 20, 40, 0.35)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '10vh',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: 520,
        maxWidth: 'calc(100vw - 48px)',
        background: 'rgba(250,251,255,0.92)',
        backdropFilter: 'blur(32px) saturate(200%)',
        WebkitBackdropFilter: 'blur(32px) saturate(200%)',
        border: '1px solid rgba(255,255,255,0.9)',
        borderRadius: 14,
        boxShadow: '0 24px 64px rgba(0,20,100,0.18), 0 2px 8px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.95)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        maxHeight: '72vh',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BellIcon size={14} />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>Reminders</span>
          </div>
          <button onClick={onClose} title="Close (Esc)"
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, color: 'var(--subtext)', lineHeight: 1 }}>
            ×
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: '6px 8px 10px' }}>
          {reminders.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--subtext)', fontSize: 12, lineHeight: 1.6 }}>
              No reminders yet.<br />
              Type <code style={{ fontFamily: 'monospace' }}>/remind</code> in a note to add one.
            </div>
          ) : GROUP_ORDER.filter(g => groups.has(g)).map(group => (
            <div key={group} style={{ marginTop: 6 }}>
              <div style={{
                fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                color: group === 'Overdue' ? 'var(--red)' : 'var(--overlay)',
                padding: '8px 10px 4px',
              }}>
                {group}
              </div>
              {groups.get(group)!.map(r => (
                <ReminderRow
                  key={r.noteId}
                  reminder={r}
                  overdue={group === 'Overdue'}
                  onOpen={() => { onOpenNote(r.noteId); onClose() }}
                  onEdit={() => setEditing(r)}
                  onClear={() => onUpdate(r.noteId, null)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <ReminderPicker
          initial={new Date(editing.scheduledAt)}
          onConfirm={async (date) => { setEditing(null); await onUpdate(editing.noteId, date) }}
          onRemove={async () => { setEditing(null); await onUpdate(editing.noteId, null) }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function ReminderRow({ reminder, overdue, onOpen, onEdit, onClear }: {
  reminder: ReminderInfo
  overdue: boolean
  onOpen: () => void
  onEdit: () => void
  onClear: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const date = new Date(reminder.scheduledAt)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onOpen}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
        background: hovered ? 'rgba(37,99,235,0.07)' : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.01em',
        }}>
          {reminder.noteTitle || 'Untitled'}
        </div>
        <div style={{ fontSize: 11, color: overdue ? 'var(--red)' : 'var(--subtext)', marginTop: 1 }}>
          {formatReminderDate(date)} · {formatRelative(date)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, opacity: hovered ? 1 : 0, transition: 'opacity 0.1s' }}>
        <RowBtn label="Edit" onClick={onEdit} />
        <RowBtn label={overdue ? 'Done' : 'Remove'} onClick={onClear} />
      </div>
    </div>
  )
}

function RowBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick() }}
      style={{
        padding: '3px 9px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
        border: '1px solid rgba(37,99,235,0.25)', background: 'rgba(255,255,255,0.7)',
        color: 'var(--accent)',
      }}
    >
      {label}
    </button>
  )
}

export function BellIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 2.2a4.3 4.3 0 0 0-4.3 4.3v2.6L2.4 11.6h11.2l-1.3-2.5V6.5A4.3 4.3 0 0 0 8 2.2Z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.4 13.4a1.7 1.7 0 0 0 3.2 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
