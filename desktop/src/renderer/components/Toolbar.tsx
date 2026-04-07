import React from 'react'
import type { AppSettings } from '../../../preload/index'

type SyncMode = AppSettings['syncMode']

interface Props {
  noteTitle: string
  isDirty: boolean
  isCompiling: boolean
  hasError: boolean
  hasPdf: boolean
  lastSaved: Date | null
  syncMode: SyncMode
  syncStatus: string
  hasActiveNote: boolean
  onSettings: () => void
  onOpenNotes: () => void
  onShare: (kind: 'pdf' | 'source') => void
}

function formatLastSaved(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 5)    return 'Saved just now'
  if (diff < 60)   return `Saved ${diff}s ago`
  if (diff < 3600) return `Saved ${Math.floor(diff / 60)}m ago`
  return `Saved at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export function Toolbar({
  noteTitle, isDirty, isCompiling, hasError, hasPdf,
  lastSaved, syncMode, syncStatus, hasActiveNote, onSettings, onOpenNotes, onShare
}: Props) {
  const [, forceUpdate] = React.useReducer(x => x + 1, 0)
  React.useEffect(() => {
    if (!lastSaved) return
    const id = setInterval(forceUpdate, 30000)
    return () => clearInterval(id)
  }, [lastSaved])

  const [isFullscreen, setIsFullscreen] = React.useState(false)
  React.useEffect(() => {
    return window.api.onFullscreenChange(setIsFullscreen)
  }, [])

  return (
    <div style={{
      height: 'var(--toolbar-h)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px 0 0',
      WebkitAppRegion: 'drag' as React.CSSProperties['WebkitAppRegion'],
      flexShrink: 0,
      position: 'relative',
      zIndex: 50,
      background: 'rgba(255,255,255,0.48)',
      backdropFilter: 'blur(24px) saturate(180%)',
      WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      borderBottom: '1px solid rgba(255,255,255,0.6)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 0 rgba(0,0,0,0.04)'
    }}>
      {/* macOS traffic-light spacer — collapses in fullscreen */}
      <div style={{ width: isFullscreen ? 16 : 82, flexShrink: 0, transition: 'width 0.2s' }} />

      {/* Left: sync pill + save status */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        WebkitAppRegion: 'no-drag' as React.CSSProperties['WebkitAppRegion'],
        flexShrink: 0,
      }}>
        <SyncModePill mode={syncMode} status={syncStatus} />
        {!isDirty && lastSaved && (
          <span style={{
            fontSize: 10,
            color: 'var(--green)',
            background: 'rgba(22,163,74,0.10)',
            border: '1px solid rgba(22,163,74,0.20)',
            borderRadius: 20,
            padding: '3px 10px',
            letterSpacing: '-0.01em',
            userSelect: 'none',
            whiteSpace: 'nowrap',
          }}>
            {formatLastSaved(lastSaved)}
          </span>
        )}
      </div>

      {/* Drag region spacer */}
      <div style={{ flex: 1, WebkitAppRegion: 'drag' as React.CSSProperties['WebkitAppRegion'] }} />

      {/* Center: Notes button + note title — absolutely pinned to true center */}
      <div style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        WebkitAppRegion: 'no-drag' as React.CSSProperties['WebkitAppRegion'],
      }}>
        <NotesBtn onClick={onOpenNotes} />
        {noteTitle && (
          <span style={{
            color: 'var(--subtext)',
            fontSize: 12,
            fontWeight: 400,
            maxWidth: 200,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            letterSpacing: '-0.01em',
            userSelect: 'none',
          }}>
            {noteTitle}
          </span>
        )}
      </div>

      {/* Right: status + export + settings */}
      <div style={{
        WebkitAppRegion: 'no-drag' as React.CSSProperties['WebkitAppRegion'],
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
      }}>
        <StatusPill isCompiling={isCompiling} hasError={hasError} />
        <ShareDropdown onShare={onShare} hasPdf={hasPdf} hasActiveNote={hasActiveNote} />
        <GearBtn onClick={onSettings} />
      </div>
    </div>
  )
}

function SyncModePill({ mode, status }: { mode: string; status: string }) {
  const modeLabel = mode === 'icloud' ? 'iCloud' : mode === 'server' ? 'Server' : 'Local'
  const statusLabel: Record<string, string> = { syncing: 'Syncing', synced: 'Synced', offline: 'Offline' }
  const extra = statusLabel[status]

  const palette =
    status === 'syncing' ? { bg: 'rgba(217,119,6,0.12)',  border: 'rgba(217,119,6,0.30)',  color: 'var(--yellow)' }
    : status === 'offline' ? { bg: 'rgba(220,38,38,0.12)',  border: 'rgba(220,38,38,0.30)',  color: 'var(--red)'    }
    : status === 'synced'  ? { bg: 'rgba(22,163,74,0.10)',  border: 'rgba(22,163,74,0.25)',  color: 'var(--green)'  }
    :                        { bg: 'rgba(255,255,255,0.45)', border: 'rgba(255,255,255,0.6)', color: 'var(--subtext)'}

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      borderRadius: 20, padding: '3px 9px',
      border: `1px solid ${palette.border}`,
      backdropFilter: 'blur(8px)',
      background: palette.bg,
      fontSize: 10, color: palette.color,
      userSelect: 'none',
      transition: 'background 0.3s, border-color 0.3s, color 0.3s',
    }}>
      <span>{modeLabel}{extra ? ` · ${extra}` : ''}</span>
    </div>
  )
}

function StatusPill({ isCompiling, hasError }: { isCompiling: boolean; hasError: boolean }) {
  let color = 'rgba(22,163,74,0.15)'
  let textColor = 'var(--green)'
  let dot = '●'
  let label = 'Ready'

  if (isCompiling) {
    color = 'rgba(217,119,6,0.12)'; textColor = 'var(--yellow)'; dot = '◌'; label = 'Compiling'
  } else if (hasError) {
    color = 'rgba(220,38,38,0.12)'; textColor = 'var(--red)'; dot = '●'; label = 'Error'
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      background: color, borderRadius: 20, padding: '3px 10px',
      border: `1px solid ${textColor}30`,
      backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)'
    }}>
      <span style={{ color: textColor, fontSize: 8, lineHeight: 1 }}>{dot}</span>
      <span style={{ color: textColor, fontSize: 11, fontWeight: 500 }}>{label}</span>
    </div>
  )
}

function NotesBtn({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = React.useState(false)
  return (
    <button
      onClick={onClick}
      title="Browse notes (⌘K)"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: hovered ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.5)',
        border: '1px solid rgba(255,255,255,0.8)',
        borderRadius: 'var(--radius-sm)',
        padding: '4px 11px',
        fontSize: 12, color: 'var(--subtext)',
        cursor: 'pointer',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        transition: 'background 0.12s',
        letterSpacing: '-0.01em',
      }}
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
        <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.8"/>
        <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
      Notes
    </button>
  )
}

function ShareDropdown({ onShare, hasPdf, hasActiveNote }: {
  onShare: (kind: 'pdf' | 'source') => void
  hasPdf: boolean
  hasActiveNote: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const disabled = !hasActiveNote
  const btnStyle: React.CSSProperties = {
    background: disabled ? 'rgba(255,255,255,0.3)' : open ? 'rgba(37,99,235,0.18)' : 'rgba(37,99,235,0.10)',
    color: disabled ? 'var(--overlay)' : 'var(--accent)',
    border: `1px solid ${disabled ? 'rgba(255,255,255,0.5)' : 'rgba(37,99,235,0.25)'}`,
    borderRadius: 'var(--radius-sm)',
    padding: '4px 11px',
    fontSize: 12,
    cursor: disabled ? 'default' : 'pointer',
    letterSpacing: '-0.01em',
    transition: 'all 0.12s',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  }
  const itemStyle = (hovered: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    fontSize: 12,
    cursor: 'pointer',
    color: hovered ? 'var(--accent)' : 'var(--text)',
    background: hovered ? 'rgba(37,99,235,0.07)' : 'transparent',
    borderRadius: 6,
    whiteSpace: 'nowrap' as const,
    transition: 'background 0.1s',
  })

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        disabled={disabled}
        onClick={() => !disabled && setOpen(v => !v)}
        style={btnStyle}
      >
        Share ▾
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 6px)',
          background: 'rgba(255,255,255,0.88)',
          backdropFilter: 'blur(28px) saturate(200%)',
          WebkitBackdropFilter: 'blur(28px) saturate(200%)',
          border: '1px solid rgba(255,255,255,0.8)',
          borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,40,120,0.13), 0 2px 8px rgba(0,0,0,0.07)',
          padding: '4px',
          zIndex: 200,
          minWidth: 140,
          WebkitAppRegion: 'no-drag' as React.CSSProperties['WebkitAppRegion'],
        }}>
          <DropdownItem
            label="PDF"
            disabled={!hasPdf}
            style={itemStyle}
            onClick={() => { setOpen(false); onShare('pdf') }}
          />
          <DropdownItem
            label="Source"
            disabled={false}
            style={itemStyle}
            onClick={() => { setOpen(false); onShare('source') }}
          />
        </div>
      )}
    </div>
  )
}

function DropdownItem({ label, disabled, style, onClick }: {
  label: string; disabled: boolean
  style: (hovered: boolean) => React.CSSProperties
  onClick: () => void
}) {
  const [hovered, setHovered] = React.useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={disabled ? undefined : onClick}
      style={{ ...style(hovered && !disabled), opacity: disabled ? 0.4 : 1, cursor: disabled ? 'default' : 'pointer' }}
    >
      {label}
    </div>
  )
}

function GearBtn({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = React.useState(false)
  return (
    <button
      onClick={onClick}
      title="Settings"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.5)',
        border: '1px solid rgba(255,255,255,0.8)',
        borderRadius: 'var(--radius-sm)',
        width: 28, height: 28,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', fontSize: 14,
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        transition: 'background 0.12s',
        color: 'var(--subtext)',
      }}
    >⚙</button>
  )
}
