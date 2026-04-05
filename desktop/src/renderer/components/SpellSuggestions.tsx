import React, { useEffect, useRef } from 'react'
import type { SpellPopup } from '../hooks/useSpellCheck'

interface Props {
  popup: SpellPopup
  onReplace: (replacement: string) => void
  onAddToDictionary: () => void
  onClose: () => void
}

export function SpellSuggestions({ popup, onReplace, onAddToDictionary, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Use capture so we catch mousedown before Monaco handles it
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [onClose])

  // Clamp popup to viewport
  const vpW = window.innerWidth
  const popupW = 200
  const left = Math.min(popup.x, vpW - popupW - 12)

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left,
        top: popup.y,
        width: popupW,
        zIndex: 200,
        background: 'rgba(255,255,255,0.88)',
        backdropFilter: 'blur(28px) saturate(200%)',
        WebkitBackdropFilter: 'blur(28px) saturate(200%)',
        border: '1px solid rgba(255,255,255,0.9)',
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,40,120,0.13), 0 2px 8px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.95)',
        overflow: 'hidden',
        fontSize: 13,
      }}
    >
      {/* Misspelled word label */}
      <div style={{
        padding: '8px 12px 6px',
        color: 'var(--overlay)',
        fontSize: 11,
        letterSpacing: '0.02em',
        borderBottom: popup.suggestions.length > 0 ? '1px solid rgba(0,0,0,0.06)' : undefined,
      }}>
        Unknown word
      </div>

      {/* Suggestions */}
      {popup.suggestions.length > 0 && (
        <div>
          {popup.suggestions.map(s => (
            <button
              key={s}
              onMouseDown={(e) => { e.preventDefault(); onReplace(s) }}
              style={itemStyle}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(37,99,235,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {popup.suggestions.length === 0 && (
        <div style={{ padding: '6px 12px', color: 'var(--overlay)', fontSize: 12 }}>
          No suggestions
        </div>
      )}

      {/* Divider */}
      <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '2px 0' }} />

      {/* Add to dictionary */}
      <button
        onMouseDown={(e) => { e.preventDefault(); onAddToDictionary() }}
        style={{ ...itemStyle, color: 'var(--accent)' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(37,99,235,0.08)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        Add "{popup.word}" to dictionary
      </button>
    </div>
  )
}

const itemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  padding: '7px 12px',
  cursor: 'pointer',
  color: 'var(--text)',
  fontSize: 13,
  fontWeight: 400,
  letterSpacing: '-0.01em',
  transition: 'background 0.1s',
}
