import React, { useRef, useState, useCallback } from 'react'
import { usePdfRenderer } from '../hooks/usePdfRenderer'
import type { CompileDiagnostic } from '../../../preload/index'

interface Props {
  pdfBytes: Uint8Array | null
  error: string | null
  diagnostics?: CompileDiagnostic[]
  isCompiling: boolean
  noteId?: string
  /** Move the editor cursor to a 1-based line/column in the note. */
  onJumpToError?: (line: number, column: number) => void
}

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

function zoomLabel(z: number): string {
  return z === 1 ? 'Fit' : `${Math.round(z * 100)}%`
}

export function PreviewPane({ pdfBytes, error, diagnostics = [], isCompiling, noteId, onJumpToError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoomIdx, setZoomIdx] = useState(2) // default: index 2 = 1.0 (Fit)
  const [fitKey, setFitKey] = useState(0)
  const zoom = ZOOM_LEVELS[zoomIdx]

  const handleFitClick = useCallback(() => {
    setZoomIdx(2)
    setFitKey(k => k + 1)
  }, [])

  usePdfRenderer(containerRef, pdfBytes, zoom, fitKey, noteId)

  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative'
    }}>
      {/* Scrollable pages */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: zoom > 1 ? 'auto' : 'hidden',
          position: 'relative',
          paddingTop: 4
        }}
      >
        {!pdfBytes && !error && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            color: 'var(--overlay)'
          }}>
            {isCompiling ? <><Spinner /><span style={{ fontSize: 12 }}>Compiling…</span></> : (
              <span style={{ fontSize: 13 }}>Start typing to see preview</span>
            )}
          </div>
        )}
      </div>

      {/* Zoom controls */}
      {pdfBytes && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          padding: '6px 0',
          flexShrink: 0,
          borderTop: '1px solid rgba(255,255,255,0.5)',
        }}>
          <button
            onClick={() => setZoomIdx(i => Math.max(0, i - 1))}
            disabled={zoomIdx === 0}
            style={zoomBtnStyle(zoomIdx === 0)}
            title="Zoom out"
          >−</button>
          <button
            onClick={handleFitClick}
            title="Reset to Fit"
            style={{
              background: 'transparent', border: 'none', borderRadius: 6,
              minWidth: 34, height: 24,
              fontSize: 11, color: 'var(--subtext)',
              textAlign: 'center', userSelect: 'none',
              letterSpacing: '-0.01em', cursor: 'pointer',
              padding: '0 4px',
            }}
          >
            {zoomLabel(zoom)}
          </button>
          <button
            onClick={() => setZoomIdx(i => Math.min(ZOOM_LEVELS.length - 1, i + 1))}
            disabled={zoomIdx === ZOOM_LEVELS.length - 1}
            style={zoomBtnStyle(zoomIdx === ZOOM_LEVELS.length - 1)}
            title="Zoom in"
          >+</button>
        </div>
      )}

      {/* Error toast */}
      {error && <ErrorPanel error={error} diagnostics={diagnostics} onJump={onJumpToError} />}
    </div>
  )
}

function zoomBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    width: 24,
    height: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.3 : 0.7,
    fontSize: 14,
    color: 'var(--subtext)',
    padding: 0,
    lineHeight: 1,
  }
}

/** Compile errors, each clickable to jump to its line/column in the editor. */
function ErrorPanel({ error, diagnostics, onJump }: {
  error: string
  diagnostics: CompileDiagnostic[]
  onJump?: (line: number, column: number) => void
}) {
  const [copied, setCopied] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(error)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // Fall back to the raw stderr when nothing could be parsed
  const items: CompileDiagnostic[] = diagnostics.length
    ? diagnostics
    : [{ severity: 'error', message: error, hints: [] }]
  const errorCount = items.filter(d => d.severity === 'error').length
  const warningCount = items.length - errorCount
  const summary = [
    errorCount ? `${errorCount} error${errorCount === 1 ? '' : 's'}` : '',
    warningCount ? `${warningCount} warning${warningCount === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(', ')

  const iconBtn = (active: boolean): React.CSSProperties => ({
    flexShrink: 0,
    background: active ? 'rgba(22,163,74,0.10)' : 'rgba(220,38,38,0.07)',
    border: `1px solid ${active ? 'rgba(22,163,74,0.2)' : 'rgba(220,38,38,0.15)'}`,
    borderRadius: 6,
    padding: '2px 7px',
    fontSize: 11,
    color: active ? 'var(--green)' : 'var(--red)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  })

  return (
    <div style={{
      position: 'absolute',
      bottom: 14,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'min(560px, 88%)',
      background: 'rgba(var(--panel-rgb),0.94)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid rgba(220,38,38,0.25)',
      borderRadius: 'var(--radius)',
      zIndex: 10,
      boxShadow: '0 4px 20px rgba(220,38,38,0.08), inset 0 1px 0 rgba(255,255,255,0.9)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 8px 6px 12px',
        borderBottom: collapsed ? 'none' : '1px solid rgba(220,38,38,0.12)',
      }}>
        <span style={{ color: 'var(--red)', fontSize: 11, fontWeight: 600, flex: 1 }}>
          ⚠ {summary || 'Compile error'}
        </span>
        <button onClick={copy} title="Copy full error output" style={iconBtn(copied)}>
          {copied ? '✓' : '⎘'}
        </button>
        <button onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Show errors' : 'Hide errors'} style={iconBtn(false)}>
          {collapsed ? '▴' : '▾'}
        </button>
      </div>

      {!collapsed && (
        <div style={{ maxHeight: 180, overflowY: 'auto', padding: 4 }}>
          {items.map((d, i) => (
            <DiagnosticRow key={i} d={d} onJump={onJump} />
          ))}
        </div>
      )}
    </div>
  )
}

function DiagnosticRow({ d, onJump }: { d: CompileDiagnostic; onJump?: (line: number, column: number) => void }) {
  const [hovered, setHovered] = useState(false)
  const jumpable = !!onJump && d.line !== undefined
  const color = d.severity === 'error' ? 'var(--red)' : 'var(--yellow)'
  const location = d.line !== undefined ? `Ln ${d.line}, Col ${d.column ?? 1}` : d.file ?? ''

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={jumpable ? () => onJump!(d.line!, d.column ?? 1) : undefined}
      title={jumpable ? 'Go to error' : undefined}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        padding: '5px 8px', borderRadius: 6,
        cursor: jumpable ? 'pointer' : 'text',
        background: jumpable && hovered ? 'rgba(220,38,38,0.06)' : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      <span style={{ color, fontSize: 9, lineHeight: '17px', flexShrink: 0 }}>●</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "'JetBrains Mono', Menlo, monospace",
          fontSize: 11, color, lineHeight: 1.5,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          userSelect: jumpable ? 'none' : 'text',
        }}>
          {d.message}
        </div>
        {d.hints.map((h, i) => (
          <div key={i} style={{ fontSize: 10, color: 'var(--subtext)', lineHeight: 1.4 }}>hint: {h}</div>
        ))}
      </div>
      {location && (
        <span style={{
          flexShrink: 0, fontSize: 10, lineHeight: '17px', whiteSpace: 'nowrap',
          color: jumpable ? 'var(--accent)' : 'var(--overlay)',
          textDecoration: jumpable && hovered ? 'underline' : 'none',
        }}>
          {location}{jumpable ? ' →' : ''}
        </span>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <div style={{
      width: 20,
      height: 20,
      borderRadius: '50%',
      border: '2px solid rgba(var(--accent-rgb),0.15)',
      borderTopColor: 'var(--accent)',
      animation: 'spin 0.7s linear infinite'
    }} />
  )
}
