import React, { useEffect, useState } from 'react'
import { quickReminderOptions, toLocalInputValue, formatReminderDate } from '../lib/reminderTime'

interface Props {
  /** Existing reminder time, when editing. */
  initial?: Date | null
  onConfirm: (date: Date) => void
  onRemove?: () => void
  onClose: () => void
}

/** Modal for choosing a reminder time — quick presets or a custom date & time. */
export function ReminderPicker({ initial, onConfirm, onRemove, onClose }: Props) {
  const [quickMode, setQuickMode] = useState(!initial)
  const [customValue, setCustomValue] = useState(() => {
    if (initial && initial.getTime() > Date.now()) return toLocalInputValue(initial)
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    return toLocalInputValue(d)
  })
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onClose])

  const options = quickReminderOptions()
  const customDate = customValue ? new Date(customValue) : null
  const customValid = !!customDate && Number.isFinite(customDate.getTime()) && customDate.getTime() > Date.now()

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface, #fff)', borderRadius: 12, padding: '20px 24px',
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)', minWidth: 300, maxWidth: 360,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {initial ? 'Edit Reminder' : 'Set Reminder'}
        </div>
        {initial && (
          <div style={{ fontSize: 11, color: 'var(--subtext)', marginTop: -6 }}>
            Currently {formatReminderDate(initial)}
          </div>
        )}
        {quickMode ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {options.map(opt => (
                <button key={opt.label} onClick={() => onConfirm(opt.date)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border, #e2e8f0)',
                    background: 'var(--bg, #f8fafc)', cursor: 'pointer', fontSize: 13,
                    color: 'var(--text)',
                  }}>
                  <span style={{ fontWeight: 500 }}>{opt.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted, #94a3b8)' }}>
                    {formatReminderDate(opt.date)}
                  </span>
                </button>
              ))}
            </div>
            <button onClick={() => setQuickMode(false)}
              style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border, #e2e8f0)', background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'var(--accent, #2563eb)', fontWeight: 500 }}>
              Choose date & time…
            </button>
          </>
        ) : (
          <>
            <input
              autoFocus
              type="datetime-local"
              value={customValue}
              min={toLocalInputValue(new Date())}
              onChange={e => setCustomValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && customValid && customDate) onConfirm(customDate) }}
              style={{
                border: '1px solid var(--border, #e2e8f0)', borderRadius: 8,
                padding: '8px 12px', fontSize: 13, outline: 'none',
                background: 'var(--bg, #f8fafc)', color: 'var(--text)',
                width: '100%', boxSizing: 'border-box',
              }}
            />
            {customValue && !customValid && (
              <div style={{ fontSize: 11, color: 'var(--red)' }}>Choose a time in the future.</div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              <button onClick={() => setQuickMode(true)}
                style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border, #e2e8f0)', background: 'transparent', cursor: 'pointer', fontSize: 12 }}>
                ← Back
              </button>
              <button
                disabled={!customValid}
                onClick={() => { if (customValid && customDate) onConfirm(customDate) }}
                style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--accent, #2563eb)', color: '#fff', cursor: customValid ? 'pointer' : 'default', fontSize: 12, fontWeight: 600, opacity: customValid ? 1 : 0.5 }}>
                {initial ? 'Update Reminder' : 'Set Reminder'}
              </button>
            </div>
          </>
        )}
        <div style={{ display: 'flex', justifyContent: onRemove ? 'space-between' : 'flex-end' }}>
          {onRemove && (
            <button onClick={onRemove}
              style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(220,38,38,0.3)', background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'var(--red)' }}>
              Remove reminder
            </button>
          )}
          <button onClick={onClose}
            style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border, #e2e8f0)', background: 'transparent', cursor: 'pointer', fontSize: 12 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
