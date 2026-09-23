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
  onAddWord: (word: string) => void
  onClearAllWords: () => void
}

export function SettingsPanel({
  open, onClose, settings, onSave, colors, onColorChange, onResetOne, onResetAll,
  customDictionary, onRemoveWord, onAddWord, onClearAllWords
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
  const [installedDicts, setInstalledDicts] = useState<{ id: string; name: string; affPath: string; dicPath: string }[]>([])
  const [activeLang, setActiveLang] = useState(settings.spellLangName || 'English (built-in)')
  const [dictLoading, setDictLoading] = useState(false)
  const [wordInput, setWordInput] = useState('')
  const [wordFilter, setWordFilter] = useState('')
  const [wordMsg, setWordMsg] = useState('')
  const [armed, setArmed] = useState<string | null>(null) // a word, or the sentinel 'clear-all'
  const armTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (armTimerRef.current) clearTimeout(armTimerRef.current) }, [])

  const arm = (target: string) => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current)
    setArmed(target)
    armTimerRef.current = setTimeout(() => setArmed(null), 2000)
  }
  const disarm = () => {
    if (armTimerRef.current) clearTimeout(armTimerRef.current)
    armTimerRef.current = null
    setArmed(null)
  }
  const submitAddWord = () => {
    const trimmed = wordInput.trim().toLowerCase()
    if (!trimmed) return
    if (customDictionary.some(w => w.toLowerCase() === trimmed)) {
      setWordMsg(`"${trimmed}" is already in your dictionary`)
      return
    }
    onAddWord(trimmed)
    setWordInput('')
    setWordMsg('')
  }

  useEffect(() => {
    setSyncMode(settings.syncMode)
    setCitationStyle(settings.citationStyle ?? 'author-date')
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
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              margin: '10px 0 4px',
            }}>
              <span style={{
                fontSize: 10, fontWeight: 600, color: 'var(--overlay)',
                letterSpacing: '0.04em', textTransform: 'uppercase',
              }}>
                Custom words · {customDictionary.length}
              </span>
              {customDictionary.length > 0 && (
                <button
                  onClick={() => { if (armed === 'clear-all') { onClearAllWords(); disarm() } else { arm('clear-all') } }}
                  style={armed === 'clear-all' ? {
                    background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.3)', color: 'var(--red)',
                    fontSize: 10, padding: '2px 7px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                  } : {
                    background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.8)', color: 'var(--subtext)',
                    fontSize: 10, padding: '2px 7px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >{armed === 'clear-all' ? `Clear ${customDictionary.length}?` : 'Clear all'}</button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 4, marginBottom: wordMsg ? 2 : 4 }}>
              <div style={{ flex: 1 }}>
                <GlassInput
                  value={wordInput}
                  onChange={v => { setWordInput(v); if (wordMsg) setWordMsg('') }}
                  placeholder="Add a word…"
                  onEnter={submitAddWord}
                />
              </div>
              <GlassBtn onClick={submitAddWord}>Add</GlassBtn>
            </div>
            {wordMsg && (
              <div style={{ fontSize: 10, color: 'var(--overlay)', marginBottom: 4 }}>{wordMsg}</div>
            )}

            {customDictionary.length > 8 && (
              <div style={{ marginBottom: 4 }}>
                <GlassInput value={wordFilter} onChange={setWordFilter} placeholder="Filter…" />
              </div>
            )}

            {customDictionary.length === 0 ? (
              <span style={{ fontSize: 11, color: 'var(--overlay)', fontStyle: 'italic' }}>
                No custom words yet. Right-click a misspelled word in the editor, or add one above.
              </span>
            ) : (() => {
              const q = wordFilter.trim().toLowerCase()
              const filtered = q ? customDictionary.filter(w => w.toLowerCase().includes(q)) : customDictionary
              if (filtered.length === 0) {
                return (
                  <span style={{ fontSize: 11, color: 'var(--overlay)', fontStyle: 'italic' }}>
                    No words match "{wordFilter.trim()}".
                  </span>
                )
              }
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 160, overflowY: 'auto', paddingRight: 4 }}>
                  {filtered.map(word => (
                    <div key={word} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: 'rgba(255,255,255,0.45)',
                      border: '1px solid rgba(255,255,255,0.7)',
                      borderRadius: 7, padding: '4px 10px',
                    }}>
                      <span style={{
                        fontSize: 12, color: 'var(--text)', flex: 1, marginRight: 6,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{word}</span>
                      <button
                        onClick={() => { if (armed === word) { onRemoveWord(word); disarm() } else { arm(word) } }}
                        style={armed === word ? {
                          background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.3)',
                          color: 'var(--red)', fontSize: 10, padding: '2px 6px', borderRadius: 5,
                          cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
                        } : {
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--overlay)', fontSize: 11, padding: '0 2px', lineHeight: 1,
                          fontFamily: 'inherit', flexShrink: 0,
                        }}
                      >{armed === word ? 'Delete?' : '✕'}</button>
                    </div>
                  ))}
                </div>
              )
            })()}
          </Card>

          {/* ── Reminders ── */}
          <Card label="Reminders">
            <div style={{ fontSize: 11, color: 'var(--subtext)', marginBottom: 8, lineHeight: 1.4 }}>
              Use <code style={{ fontFamily: 'monospace' }}>/remind</code> in a note to schedule one.
              If banners don't appear, grant notification permission to
              {' '}<code style={{ fontFamily: 'monospace' }}>Glyph Folio</code> (or
              {' '}<code style={{ fontFamily: 'monospace' }}>Electron</code> in dev)
              {' '}in System Settings.
            </div>
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
