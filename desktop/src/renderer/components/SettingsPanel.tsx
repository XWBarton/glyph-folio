import React, { useState, useEffect } from 'react'
import type { AppSettings } from '../../../preload/index'
import { TOKEN_DEFS, DEFAULT_TOKEN_COLORS, type TokenColors } from '../lib/tokenColors'

interface Props {
  open: boolean
  onClose: () => void
  settings: AppSettings
  onSave: (s: Partial<AppSettings>) => void
  colors: TokenColors
  onColorChange: (id: string, color: string) => void
  onResetOne: (id: string) => void
  onResetAll: () => void
  customDictionary: string[]
  onRemoveWord: (word: string) => void
}

export function SettingsPanel({
  open, onClose, settings, onSave, colors, onColorChange, onResetOne, onResetAll,
  customDictionary, onRemoveWord
}: Props) {
  const [syncMode, setSyncMode] = useState(settings.syncMode)
  const [serverUrl, setServerUrl] = useState(settings.serverUrl)
  const [authToken, setAuthToken] = useState(settings.authToken ?? '')
  const [notesDir, setNotesDir] = useState(settings.notesDir)
  const [fontSize, setFontSize] = useState(settings.fontSize)
  const [testStatus, setTestStatus] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [testMsg, setTestMsg] = useState('')
  const [installedDicts, setInstalledDicts] = useState<{ id: string; name: string; affPath: string; dicPath: string }[]>([])
  const [activeLang, setActiveLang] = useState(settings.spellLangName || 'English (built-in)')
  const [dictLoading, setDictLoading] = useState(false)

  useEffect(() => {
    setSyncMode(settings.syncMode)
    setServerUrl(settings.serverUrl)
    setAuthToken(settings.authToken ?? '')
    setNotesDir(settings.notesDir)
    setFontSize(settings.fontSize)
    setActiveLang(settings.spellLangName || 'English (built-in)')
  }, [settings])

  useEffect(() => {
    window.api.spellListInstalled().then(setInstalledDicts)
  }, [])

  const loadDict = async (affPath: string, dicPath: string, langName: string) => {
    setDictLoading(true)
    const result = await window.api.spellLoadDictFiles(affPath, dicPath, langName)
    setDictLoading(false)
    if ('error' in result) { alert(result.error); return }
    const { reinitChecker } = await import('../lib/spellChecker')
    reinitChecker(result.aff, result.dic)
    setActiveLang(langName)
    onSave({ spellAffPath: affPath, spellDicPath: dicPath, spellLangName: langName })
  }

  const pickCustomDict = async () => {
    setDictLoading(true)
    const result = await window.api.spellPickDict()
    setDictLoading(false)
    if (!result || 'error' in result) { if (result && 'error' in result) alert(result.error); return }
    const { reinitChecker } = await import('../lib/spellChecker')
    reinitChecker(result.aff, result.dic)
    setActiveLang(result.name)
    onSave({ spellAffPath: result.affPath, spellDicPath: result.dicPath, spellLangName: result.name })
    window.api.spellListInstalled().then(setInstalledDicts)
  }

  const resetToBuiltIn = async () => {
    const { resetToEnglish } = await import('../lib/spellChecker')
    resetToEnglish()
    setActiveLang('English (built-in)')
    onSave({ spellAffPath: '', spellDicPath: '', spellLangName: '' })
  }

  const handleSave = () => {
    onSave({ syncMode, serverUrl, authToken, notesDir, fontSize })
    onClose()
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
            fontSize: 12, fontWeight: 600, color: 'var(--text)',
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

          {/* ── Spelling ── */}
          <Card label="Spelling">
            <Row label="Active">
              <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dictLoading ? 'Loading…' : activeLang}</span>
            </Row>

            {/* Installed dicts */}
            {installedDicts.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '8px 0 4px' }}>
                {installedDicts.map(d => (
                  <button
                    key={d.id}
                    onClick={() => loadDict(d.affPath, d.dicPath, d.name)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: activeLang === d.name ? 'rgba(37,99,235,0.10)' : 'rgba(255,255,255,0.5)',
                      border: `1px solid ${activeLang === d.name ? 'rgba(37,99,235,0.25)' : 'rgba(255,255,255,0.7)'}`,
                      borderRadius: 8, padding: '5px 10px',
                      fontSize: 12, color: activeLang === d.name ? 'var(--accent)' : 'var(--text)',
                      cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                    }}
                  >
                    <span>{d.name}</span>
                    {activeLang === d.name && <span style={{ fontSize: 10 }}>✓</span>}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              <GlassBtn onClick={pickCustomDict}>Choose .aff file…</GlassBtn>
              {activeLang !== 'English (built-in)' && (
                <GlassBtn onClick={resetToBuiltIn}>Reset</GlassBtn>
              )}
            </div>

            {/* Install instructions */}
            <div style={{
              marginTop: 10, padding: '8px 10px',
              background: 'rgba(0,0,0,0.03)', borderRadius: 8,
              border: '1px solid rgba(0,0,0,0.06)',
            }}>
              <div style={{ fontSize: 10, color: 'var(--overlay)', marginBottom: 4 }}>
                Install any language with one command, then restart:
              </div>
              <code style={{
                fontSize: 10, color: 'var(--text)',
                background: 'rgba(0,0,0,0.05)', borderRadius: 4,
                padding: '3px 6px', display: 'block',
                fontFamily: 'monospace', letterSpacing: 0,
              }}>
                npm install dictionary-en-au
              </code>
              <div style={{ fontSize: 10, color: 'var(--overlay)', marginTop: 4 }}>
                Replace <code style={{ fontFamily: 'monospace' }}>en-au</code> with any code from <span style={{ color: 'var(--accent)' }}>npmjs.com</span>
              </div>
            </div>

            <div style={{
              fontSize: 10, fontWeight: 600, color: 'var(--overlay)',
              letterSpacing: '0.04em', textTransform: 'uppercase',
              margin: '10px 0 4px',
            }}>
              Custom words · {customDictionary.length}
            </div>
            {customDictionary.length === 0 ? (
              <span style={{ fontSize: 11, color: 'var(--overlay)', fontStyle: 'italic' }}>
                Right-click a misspelled word to add it.
              </span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {customDictionary.map(word => (
                  <div key={word} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'rgba(255,255,255,0.45)',
                    border: '1px solid rgba(255,255,255,0.7)',
                    borderRadius: 7, padding: '4px 10px',
                  }}>
                    <span style={{ fontSize: 12, color: 'var(--text)' }}>{word}</span>
                    <button
                      onClick={() => onRemoveWord(word)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--overlay)', fontSize: 11, padding: '0 2px', lineHeight: 1,
                        fontFamily: 'inherit',
                      }}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
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

function GlassInput({ value, onChange, placeholder, password }: { value: string; onChange: (v: string) => void; placeholder?: string; password?: boolean }) {
  return (
    <input
      type={password ? 'password' : 'text'}
      value={value}
      onChange={e => onChange(e.target.value)}
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
