import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import type { NoteMeta } from '../hooks/useNotes'
import { kbd } from '../lib/kbd'

interface Props {
  tabs: NoteMeta[]
  activeId: string | null
  /** Live title of the active note (the list copy lags until autosave). */
  activeTitle: string
  onSelect: (note: NoteMeta) => void
  onClose: (id: string) => void
  onReorder: (fromId: string, toIndex: number) => void
  onOpenInWindow: (id: string) => void
  onCloseOthers: (id: string) => void
  onNew: () => void
}

/** Two-letter badge for a tab: initials of the first two words, Typst markup stripped. */
function tabInitials(title: string): string {
  const words = title.replace(/[*_`#=]/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)
  return letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase()
}

// Narrow sliver of square tabs down the left edge; full title on hover.
export function TabStrip({
  tabs, activeId, activeTitle, onSelect, onClose, onReorder, onOpenInWindow, onCloseOthers, onNew
}: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null)

  const endDrag = () => { setDragId(null); setDropIndex(null) }

  return (
    <div style={{
      width: 36, flexShrink: 0, marginRight: 10,
      display: 'flex', flexDirection: 'column',
      borderRadius: 'var(--radius)',
      background: 'rgba(var(--panel-rgb),0.45)',
      backdropFilter: 'blur(24px) saturate(180%)',
      WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      border: '1px solid var(--glass-border)',
      boxShadow: 'var(--glass-shadow), inset 0 1px 0 rgba(255,255,255,0.95)',
      overflow: 'hidden',
    }}>
      <div
        style={{
          flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 0',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
          scrollbarWidth: 'none',
        }}
        onDragOver={e => { if (dragId) { e.preventDefault(); setDropIndex(tabs.length) } }}
        onDrop={e => {
          e.preventDefault()
          if (dragId && dropIndex !== null) onReorder(dragId, dropIndex)
          endDrag()
        }}
      >
        {tabs.map((note, i) => {
          const isActive = note.id === activeId
          const isHover = hoverId === note.id
          const title = (isActive ? activeTitle : note.title) || 'Untitled'
          return (
            <div
              key={note.id}
              draggable
              title={title}
              onClick={() => { if (!isActive) onSelect(note) }}
              // Middle-click closes, like a browser tab
              onAuxClick={e => { if (e.button === 1) { e.preventDefault(); onClose(note.id) } }}
              onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, id: note.id }) }}
              onMouseEnter={() => setHoverId(note.id)}
              onMouseLeave={() => setHoverId(h => (h === note.id ? null : h))}
              onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragId(note.id) }}
              onDragEnd={endDrag}
              onDragOver={e => {
                if (!dragId) return
                e.preventDefault()
                e.stopPropagation()
                const rect = e.currentTarget.getBoundingClientRect()
                setDropIndex(e.clientY < rect.top + rect.height / 2 ? i : i + 1)
              }}
              style={{
                position: 'relative', flexShrink: 0,
                width: 26, height: 26,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 6,
                cursor: 'default',
                fontSize: 10.5, letterSpacing: '-0.02em',
                color: isActive ? 'var(--accent)' : 'var(--subtext)',
                fontWeight: isActive ? 700 : 500,
                background: isActive ? 'var(--accent-soft)' : isHover ? 'rgba(var(--panel-rgb),0.75)' : 'rgba(var(--panel-rgb),0.4)',
                border: `1px solid ${isActive ? 'rgba(var(--accent-rgb),0.3)' : 'rgba(255,255,255,0.7)'}`,
                opacity: dragId === note.id ? 0.4 : 1,
                boxShadow: dropIndex === i && dragId ? '0 -3px 0 -1px var(--accent)'
                  : dropIndex === i + 1 && i === tabs.length - 1 && dragId ? '0 3px 0 -1px var(--accent)'
                  : 'none',
                userSelect: 'none',
              }}
            >
              {tabInitials(title)}
              {isHover && (
                <button
                  onClick={e => { e.stopPropagation(); onClose(note.id) }}
                  title={kbd('Close tab (⌘W)')}
                  style={{
                    position: 'absolute', top: -3, right: -3,
                    width: 12, height: 12, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(var(--panel-rgb),0.95)',
                    border: '1px solid rgba(var(--ink-rgb),0.12)',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                    cursor: 'pointer', color: 'var(--subtext)', fontSize: 7, lineHeight: 1,
                    padding: 0, fontFamily: 'inherit',
                  }}
                >✕</button>
              )}
            </div>
          )
        })}
      </div>

      <button
        onClick={onNew}
        title={kbd('New Note (⌘N)')}
        style={{
          flexShrink: 0, height: 28,
          background: 'transparent', border: 'none',
          borderTop: '1px solid rgba(255,255,255,0.5)',
          fontSize: 15, lineHeight: 1, color: 'var(--subtext)', cursor: 'pointer',
          fontFamily: 'inherit',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(var(--panel-rgb),0.45)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >+</button>

      {/* Portal: the strip's backdrop-filter would otherwise trap and clip position: fixed */}
      {contextMenu && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setContextMenu(null)} onContextMenu={e => { e.preventDefault(); setContextMenu(null) }} />
          <div style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 100,
            background: 'rgba(var(--panel-rgb),0.92)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            border: '1px solid rgba(255,255,255,0.85)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 8px 32px rgba(0,40,120,0.10)',
            padding: 4, minWidth: 160,
          }}>
            <MenuItem label="Open in New Window" onClick={() => { onOpenInWindow(contextMenu.id); setContextMenu(null) }} />
            <MenuItem label="Close Tab" onClick={() => { onClose(contextMenu.id); setContextMenu(null) }} />
            <MenuItem label="Close Other Tabs" onClick={() => { onCloseOthers(contextMenu.id); setContextMenu(null) }} />
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', background: 'transparent', border: 'none',
        borderRadius: 7, padding: '7px 10px', textAlign: 'left',
        fontSize: 12, color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(var(--accent-rgb),0.08)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >{label}</button>
  )
}
