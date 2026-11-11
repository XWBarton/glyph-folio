import React, { useState, useEffect } from 'react'
import type { AppSettings } from '../../../preload/index'
import { TOKEN_DEFS, DEFAULT_TOKEN_COLORS, type TokenColors } from '../lib/tokenColors'
import { kbd, isMac } from '../lib/kbd'

interface Props {
  open: boolean
  onClose: () => void
  settings: AppSettings
  onSave: (s: Partial<AppSettings>) => void
  colors: TokenColors
  onColorChange: (id: string, color: string) => void
  onResetOne: (id: string) => void
  onResetAll: () => void
  customWordCount: number
  onOpenDictionary: () => void
}

export function SettingsPanel({
  open, onClose, settings, onSave, colors, onColorChange, onResetOne, onResetAll,
  customWordCount, onOpenDictionary
}: Props) {
  const [syncMode, setSyncMode] = useState(settings.syncMode)
  const [citationStyle, setCitationStyle] = useState(settings.citationStyle ?? 'author-date')
  const [serverUrl, setServerUrl] = useState(settings.serverUrl)
  const [authToken, setAuthToken] = useState(settings.authToken ?? '')
  const [notesDir, setNotesDir] = useState(settings.notesDir)
  const [fontSize, setFontSize] = useState(settings.fontSize)
  const [testStatus, setTestStatus] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [testMsg, setTestMsg] = useState('')
  const [notifStatus, setNotifStatus] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [notifMsg, setNotifMsg] = useState('')
  useEffect(() => {
    setSyncMode(settings.syncMode)
    setCitationStyle(settings.citationStyle ?? 'author-date')
    setServerUrl(settings.serverUrl)
    setAuthToken(settings.authToken ?? '')
    setNotesDir(settings.notesDir)
    setFontSize(settings.fontSize)
  }, [settings])

  const handleSave = () => {
    onSave({ syncMode, serverUrl, authToken, notesDir, fontSize, citationStyle })
    onClose()
  }

  const testNotification = async () => {
    setNotifStatus('idle')
    setNotifMsg('Sending…')
    const result = await window.api.reminderTest()
    if (!result.supported) {
      setNotifStatus('fail')
      setNotifMsg('Not supported on this system')
      return
    }
    if (result.shown) {
      setNotifStatus('ok')
      setNotifMsg('Sent — if no banner appeared, check System Settings → Notifications')
    } else {
      setNotifStatus('fail')
      setNotifMsg(result.error ?? 'Failed — check notification permission in System Settings')
    }
  }

  const testConnection = async () => {
    setTestStatus('idle')
    setTestMsg('Testing…')
    const result = await window.api.syncTestServer(serverUrl, authToken || undefined)
    if (result.ok) {
      setTestStatus('ok')
      setTestMsg('Connected — saved')
      onSave({ syncMode, serverUrl, authToken, notesDir, fontSize })
    } else {
      setTestStatus('fail')
      setTestMsg(result.error ?? 'Failed')
    }
  }

  return (
    <>
      {open && (
        <div
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, zIndex: 40 }}
        />
      )}

      <div style={{
        position: 'fixed',
        top: 0, right: 0, bottom: 0,
        width: 300,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.26s cubic-bezier(0.4, 0, 0.2, 1)',
        background: 'rgba(240,244,255,0.72)',
        backdropFilter: 'blur(40px) saturate(200%)',
        WebkitBackdropFilter: 'blur(40px) saturate(200%)',
        borderLeft: '1px solid rgba(255,255,255,0.7)',
        boxShadow: '-12px 0 48px rgba(0,40,120,0.10), -1px 0 0 rgba(255,255,255,0.5)',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 16px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: 12, fontWeight: 600,
            letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'var(--overlay)',
          }}>
            Settings
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.06)',
              borderRadius: 6, width: 22, height: 22,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 10, color: 'var(--subtext)',
              lineHeight: 1,
            }}
          >✕</button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>

          {/* ── Sync ── */}
          <Card label="Sync">
            <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
              {(['local', 'server'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setSyncMode(mode)}
                  style={{
                    flex: 1,
                    background: syncMode === mode ? 'rgba(37,99,235,0.12)' : 'rgba(255,255,255,0.5)',
                    border: `1px solid ${syncMode === mode ? 'rgba(37,99,235,0.25)' : 'rgba(255,255,255,0.7)'}`,
                    borderRadius: 8,
                    padding: '5px 0',
                    fontSize: 11,
                    fontWeight: syncMode === mode ? 600 : 400,
                    color: syncMode === mode ? 'var(--accent)' : 'var(--subtext)',
                    cursor: 'pointer',
                    letterSpacing: '-0.01em',
                    transition: 'all 0.1s',
                    fontFamily: 'inherit',
                  }}
                >
                  {mode === 'server' ? 'Server' : 'Local'}
                </button>
              ))}
            </div>

            {syncMode === 'server' && (
              <>
                <GlassInput
                  value={serverUrl}
                  onChange={setServerUrl}
                  placeholder="https://folio.example.com or http://192.168.1.x:3001"
                />
                <GlassInput
                  value={authToken}
                  onChange={setAuthToken}
                  placeholder="Auth token (if set)"
                  password
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <GlassBtn onClick={testConnection}>Test</GlassBtn>
                  {testMsg && (
                    <span style={{
                      fontSize: 11,
                      color: testStatus === 'ok' ? 'var(--green)' : testStatus === 'fail' ? 'var(--red)' : 'var(--subtext)'
                    }}>{testMsg}</span>
                  )}
                </div>
              </>
            )}
            {syncMode === 'local' && (
              <GlassInput
                value={notesDir}
                onChange={setNotesDir}
                placeholder="~/Documents/GlyphFolio"
              />
            )}
          </Card>

          {/* ── Tabs & Windows ── */}
          <Card label="Tabs & Windows">
            <ToggleRow
              label="Show tab strip"
              hint={kbd('Compact list of open notes down the left edge. ⌃Tab or ⇧⌘] / ⇧⌘[ to switch, ⌘W to close.')}
              checked={settings.showTabs ?? true}
              onChange={v => onSave({ showTabs: v })}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <GlassBtn onClick={() => window.api.windowOpenNote()}>Open new window</GlassBtn>
              <span style={{ fontSize: 10, color: 'var(--overlay)', lineHeight: 1.35 }}>
                {kbd('Also ⇧⌘N')}, or right-click a tab → Open in New Window
              </span>
            </div>
          </Card>

          {/* ── Citations ── */}
          <Card label="Citations">
            <div style={{ display: 'flex', gap: 4 }}>
              {([
                ['author-date', 'Author-Date'],
                ['numbered', 'Numbered'],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => { setCitationStyle(mode); onSave({ citationStyle: mode }) }}
                  style={{
                    flex: 1,
                    background: citationStyle === mode ? 'rgba(37,99,235,0.12)' : 'rgba(255,255,255,0.5)',
                    border: `1px solid ${citationStyle === mode ? 'rgba(37,99,235,0.25)' : 'rgba(255,255,255,0.7)'}`,
                    borderRadius: 8,
                    padding: '5px 0',
                    fontSize: 11,
                    fontWeight: citationStyle === mode ? 600 : 400,
                    color: citationStyle === mode ? 'var(--accent)' : 'var(--subtext)',
                    cursor: 'pointer',
                    letterSpacing: '-0.01em',
                    transition: 'all 0.1s',
                    fontFamily: 'inherit',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: 'var(--overlay)', marginTop: 8, lineHeight: 1.5 }}>
              Controls how <code style={{ fontFamily: 'monospace' }}>@key</code> and{' '}
              <code style={{ fontFamily: 'monospace' }}>[@key]</code> citations and the reference list
              are rendered in exported PDFs.
            </div>
          </Card>

          {/* ── Spelling ── */}
          <Card label="Spelling">
            <Row label="Language">
              <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {settings.spellLangName || 'English (built-in)'}
              </span>
            </Row>
            <Row label="Custom">
              <span style={{ fontSize: 11, color: 'var(--text)', flex: 1 }}>
                {customWordCount} word{customWordCount === 1 ? '' : 's'}
              </span>
            </Row>
            <div style={{ marginTop: 8 }}>
              <GlassBtn onClick={onOpenDictionary}>{kbd('Open Dictionary… (⇧⌘D)')}</GlassBtn>
            </div>
          </Card>

          {/* ── Reminders ── */}
          <Card label="Reminders">
            <div style={{ fontSize: 11, color: 'var(--subtext)', marginBottom: 8, lineHeight: 1.4 }}>
              Use <code style={{ fontFamily: 'monospace' }}>/remind</code> in a note to schedule one, and
              {' '}<b>{kbd('⌥⌘R')}</b> or the bell to see everything upcoming.
              If banners don't appear, grant notification permission to
              {' '}<code style={{ fontFamily: 'monospace' }}>Glyph Folio</code> (or
              {' '}<code style={{ fontFamily: 'monospace' }}>Electron</code> in dev)
              {' '}in {isMac ? 'System Settings' : 'Settings → System → Notifications'}.
            </div>
            <ToggleRow
              label={isMac ? 'Keep running in menu bar' : 'Keep running in system tray'}
              hint="Closing the window or quitting keeps Glyph Folio in the background so reminders still fire."
              checked={settings.runInBackground ?? true}
              onChange={v => onSave({ runInBackground: v })}
            />
            <ToggleRow
              label="Open at login"
              hint="Starts hidden in the background after you sign in."
              checked={settings.openAtLogin ?? false}
              onChange={v => onSave({ openAtLogin: v })}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <GlassBtn onClick={testNotification}>Test notification</GlassBtn>
              {notifMsg && (
                <span style={{
                  fontSize: 11, lineHeight: 1.35,
                  color: notifStatus === 'ok' ? 'var(--green)' : notifStatus === 'fail' ? 'var(--red)' : 'var(--subtext)'
                }}>{notifMsg}</span>
              )}
            </div>
          </Card>

          {/* ── Syntax Colors ── */}
          <Card label="Syntax Colors">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <GlassBtn onClick={onResetAll}>Reset all</GlassBtn>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {TOKEN_DEFS.map(def => (
                <div key={def.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '5px 2px',
                  borderBottom: '1px solid rgba(255,255,255,0.4)',
                }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text)', letterSpacing: '-0.01em' }}>{def.label}</div>
                    <div style={{ fontSize: 10, color: 'var(--overlay)' }}>{def.description}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {colors[def.id] !== DEFAULT_TOKEN_COLORS[def.id] && (
                      <button
                        onClick={() => onResetOne(def.id)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--overlay)', fontSize: 12, padding: 0,
                          fontFamily: 'inherit',
                        }}
                      >↺</button>
                    )}
                    <ColorSwatch
                      color={colors[def.id] ?? def.defaultColor}
                      onChange={c => onColorChange(def.id, c)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 14px',
          borderTop: '1px solid rgba(255,255,255,0.5)',
          flexShrink: 0,
          display: 'flex', gap: 6, justifyContent: 'flex-end',
        }}>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.5)',
            border: '1px solid rgba(255,255,255,0.7)',
            borderRadius: 8, padding: '5px 14px',
            fontSize: 12, cursor: 'pointer',
            color: 'var(--subtext)', fontFamily: 'inherit',
          }}>Cancel</button>
          <button onClick={handleSave} style={{
            background: 'rgba(37,99,235,0.12)',
            border: '1px solid rgba(37,99,235,0.25)',
            borderRadius: 8, padding: '5px 14px',
            fontSize: 12, cursor: 'pointer',
            color: 'var(--accent)', fontWeight: 600, fontFamily: 'inherit',
          }}>Save</button>
        </div>
      </div>
    </>
  )
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.5)',
      border: '1px solid rgba(255,255,255,0.75)',
      borderRadius: 12,
      padding: '10px 12px',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9)',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.07em',
        textTransform: 'uppercase', color: 'var(--overlay)',
        marginBottom: 8,
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function Row({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
      <span style={{ fontSize: 12, color: 'var(--subtext)', flexShrink: 0, minWidth: 64 }}>{label}</span>
      {children}
      {value && <span style={{ fontSize: 11, color: 'var(--overlay)', minWidth: 28, textAlign: 'right' }}>{value}</span>}
    </div>
  )
}

function GlassInput({ value, onChange, placeholder, password, onEnter }: { value: string; onChange: (v: string) => void; placeholder?: string; password?: boolean; onEnter?: () => void }) {
  return (
    <input
      type={password ? 'password' : 'text'}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={onEnter ? (e => { if (e.key === 'Enter') onEnter() }) : undefined}
      placeholder={placeholder}
      style={{
        width: '100%', boxSizing: 'border-box',
        background: 'rgba(255,255,255,0.6)',
        border: '1px solid rgba(255,255,255,0.8)',
        borderRadius: 8, padding: '5px 9px',
        fontSize: 12, color: 'var(--text)',
        outline: 'none', fontFamily: 'inherit',
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04)',
      }}
    />
  )
}

function ColorSwatch({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  return (
    <div
      onClick={() => inputRef.current?.click()}
      style={{
        width: 22, height: 22, borderRadius: '50%',
        background: color,
        border: '2px solid rgba(255,255,255,0.8)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        cursor: 'pointer', flexShrink: 0,
        position: 'relative',
      }}
    >
      <input
        ref={inputRef}
        type="color"
        value={color}
        onChange={e => onChange(e.target.value)}
        style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
      />
    </div>
  )
}

function ToggleRow({ label, hint, checked, onChange }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: 'var(--accent)', cursor: 'pointer' }}
      />
      <span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--text)' }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: 10, color: 'var(--overlay)', lineHeight: 1.35 }}>{hint}</span>}
      </span>
    </label>
  )
}

function GlassBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'rgba(255,255,255,0.6)',
        border: '1px solid rgba(255,255,255,0.8)',
        borderRadius: 7, padding: '4px 10px',
        fontSize: 11, color: 'var(--subtext)',
        cursor: 'pointer', fontFamily: 'inherit',
      }}
    >{children}</button>
  )
}
