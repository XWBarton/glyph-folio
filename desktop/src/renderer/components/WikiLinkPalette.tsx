import React, { useEffect, useRef } from 'react'
import type { NoteMeta } from '../hooks/useNotes'

interface Props {
  open: boolean
  x: number
  y: number
  notes: NoteMeta[]
  selectedIndex: number
  onSelect: (note: NoteMeta) => void
  onClose: () => void
}

export function WikiLinkPalette({ open, x, y, notes, selectedIndex, onSelect, onClose }: Props) {
  const selectedRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (!open || notes.length === 0) return null

  const panelWidth = 260
  const panelMaxHeight = 240
  const adjustedX = Math.min(x, window.innerWidth - panelWidth - 8)
  const adjustedY = y + panelMaxHeight > window.innerHeight ? y - panelMaxHeight - 28 : y

  return (
    <>
      <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
      <div style={{
        position: 'fixed', left: adjustedX, top: adjustedY,
        width: panelWidth, maxHeight: panelMaxHeight,
        zIndex: 100, display: 'flex', flexDirection: 'column',
        background: '#ffffff',
        border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12,
        boxShadow: '0 8px 40px rgba(0,40,120,0.13), 0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.95)',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '6px 10px 4px', fontSize: 10, fontWeight: 600,
          letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--overlay)',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
        }}>
          Link to note
        </div>
        <div style={{ overflowY: 'auto', padding: '4px 0' }}>
          {notes.map((note, idx) => {
            const isSelected = idx === selectedIndex
            return (
              <div
                key={note.id}
                ref={isSelected ? selectedRef : undefined}
                onMouseDown={e => { e.preventDefault(); onSelect(note) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 12px', cursor: 'pointer',
                  background: isSelected ? 'rgba(37,99,235,0.10)' : 'transparent',
                  borderRadius: isSelected ? 8 : 0,
                  margin: isSelected ? '0 4px' : '0',
                  transition: 'background 0.08s',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ fontSize: 12, color: 'var(--subtext)', flexShrink: 0 }}>[[</span>
                <span style={{
                  fontSize: 13, fontWeight: 500, color: 'var(--text)',
                  letterSpacing: '-0.01em',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                }}>{note.title}</span>
                <span style={{ fontSize: 12, color: 'var(--subtext)', flexShrink: 0 }}>]]</span>
              </div>
            )
          })}
        </div>
        <div style={{
          padding: '5px 12px', borderTop: '1px solid rgba(0,0,0,0.05)',
          display: 'flex', gap: 10, alignItems: 'center',
        }}>
          {[['↑↓', 'navigate'], ['↵', 'insert'], ['Esc', 'close']].map(([k, l]) => (
            <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--overlay)' }}>
              <kbd style={{ background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 4, padding: '1px 5px', fontFamily: 'system-ui', fontSize: 10 }}>{k}</kbd>
              {l}
            </span>
          ))}
        </div>
      </div>
    </>
  )
}
