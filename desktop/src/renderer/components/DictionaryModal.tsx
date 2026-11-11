import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings } from '../../../preload/index'
import { kbd } from '../lib/kbd'

interface Props {
  open: boolean
  onClose: () => void
  words: string[]
  /** Replace the whole custom word list (App normalises + persists). */
  onChangeWords: (next: string[]) => void
  spellLangName: string
  onSaveSettings: (s: Partial<AppSettings>) => void
}

type InstalledDict = { id: string; name: string; affPath: string; dicPath: string }

const BUILT_IN = 'English (built-in)'

/** Split pasted/typed text into candidate words: "foo, bar baz" → [foo, bar, baz]. */
function tokenize(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase())
    .filter(Boolean)
}

/** Parse a word-list file: plain text (one per line) or a Hunspell .dic (count line, word/FLAGS). */
function parseWordFile(text: string): string[] {
  const lines = text.split(/\r?\n/)
  if (/^\d+\s*$/.test(lines[0] ?? '')) lines.shift()
  return lines.flatMap(l => tokenize(l.split('/')[0]))
}

export function DictionaryModal({ open, onClose, words, onChangeWords, spellLangName, onSaveSettings }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{ word: string; value: string } | null>(null)
  const [undo, setUndo] = useState<{ label: string; words: string[] | null } | null>(null)  // words = state to restore
  const [confirmClear, setConfirmClear] = useState(false)
  const [installedDicts, setInstalledDicts] = useState<InstalledDict[]>([])
  const [activeLang, setActiveLang] = useState(spellLangName || BUILT_IN)
  const [langLoading, setLangLoading] = useState(false)
  const [langError, setLangError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const cancelEditRef = useRef(false)  // Esc must not commit via the trailing blur

  useEffect(() => { setActiveLang(spellLangName || BUILT_IN) }, [spellLangName])

  // Reset transient state each time the modal opens
  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(new Set())
    setEditing(null)
    setConfirmClear(false)
    setLangError('')
    window.api.spellListInstalled().then(setInstalledDicts)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current) }, [])

  const wordSet = useMemo(() => new Set(words.map(w => w.toLowerCase())), [words])
  const q = query.trim().toLowerCase()
  const candidates = useMemo(() => tokenize(query), [query])
  const newWords = useMemo(() => [...new Set(candidates)].filter(w => !wordSet.has(w)), [candidates, wordSet])
  // A single typed term filters the list; a pasted batch doesn't
  const filtered = useMemo(() => {
    if (!q || candidates.length > 1) return words
    return words.filter(w => w.toLowerCase().includes(candidates[0] ?? q))
  }, [words, q, candidates])

  // Group by first letter for the A–Z index (only when browsing, not searching)
  const showIndex = !q && words.length > 30
  const groups = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const w of filtered) {
      const ch = w[0]?.toUpperCase() ?? '#'
      const key = /\p{L}/u.test(ch) ? ch : '#'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(w)
    }
    return [...map.entries()]
  }, [filtered])

  // ── Mutations ───────────────────────────────────────────────────────────────

  const showUndo = (label: string, previous: string[]) => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndo({ label, words: previous })
    undoTimer.current = setTimeout(() => setUndo(null), 6000)
  }

  const addWords = (list: string[]) => {
    const fresh = [...new Set(list)].filter(w => !wordSet.has(w))
    if (fresh.length === 0) return 0
    onChangeWords([...words, ...fresh])
    return fresh.length
  }

  const removeWords = (list: string[]) => {
    if (list.length === 0) return
    const drop = new Set(list)
    const previous = words
    onChangeWords(words.filter(w => !drop.has(w)))
    setSelected(new Set())
    showUndo(list.length === 1 ? `Removed "${list[0]}"` : `Removed ${list.length} words`, previous)
  }

  const commitEdit = () => {
    if (cancelEditRef.current) { cancelEditRef.current = false; return }
    if (!editing) return
    const next = tokenize(editing.value)[0]
    setEditing(null)
    if (!next || next === editing.word) return
    const previous = words
    const without = words.filter(w => w !== editing.word)
    onChangeWords(without.some(w => w.toLowerCase() === next) ? without : [...without, next])
    showUndo(`Renamed "${editing.word}" → "${next}"`, previous)
  }

  const submitQuery = () => {
    if (newWords.length === 0) return
    addWords(newWords)
    setQuery('')
  }

  const clearAll = () => {
    const previous = words
    onChangeWords([])
    setSelected(new Set())
    setConfirmClear(false)
    showUndo(`Cleared ${previous.length} words`, previous)
  }

  const exportWords = () => {
    const blob = new Blob([[...words].sort().join('\n') + '\n'], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'glyph-folio-dictionary.txt'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const importFile = async (file: File) => {
    const added = addWords(parseWordFile(await file.text()))
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndo({ label: added ? `Imported ${added} new word${added === 1 ? '' : 's'}` : 'No new words in that file', words: added ? words : null })
    undoTimer.current = setTimeout(() => setUndo(null), 6000)
  }

  const toggleSelect = (word: string, e: React.MouseEvent) => {
    setSelected(prev => {
      const next = new Set(e.metaKey || e.ctrlKey || e.shiftKey ? prev : [])
      if (prev.has(word) && (e.metaKey || e.ctrlKey || e.shiftKey || prev.size === 1)) next.delete(word)
      else next.add(word)
      return next
    })
  }

  // ── Language dictionaries ──────────────────────────────────────────────────

  const loadDict = async (affPath: string, dicPath: string, langName: string) => {
    setLangLoading(true)
    setLangError('')
    const result = await window.api.spellLoadDictFiles(affPath, dicPath, langName)
    setLangLoading(false)
    if ('error' in result) { setLangError(result.error); return }
    const { reinitChecker } = await import('../lib/spellChecker')
    reinitChecker(result.aff, result.dic)
    setActiveLang(langName)
    onSaveSettings({ spellAffPath: affPath, spellDicPath: dicPath, spellLangName: langName })
  }

  const pickCustomDict = async () => {
    setLangLoading(true)
    setLangError('')
    const result = await window.api.spellPickDict()
    setLangLoading(false)
    if (!result) return
    if ('error' in result) { setLangError(result.error); return }
    const { reinitChecker } = await import('../lib/spellChecker')
    reinitChecker(result.aff, result.dic)
    setActiveLang(result.name)
    onSaveSettings({ spellAffPath: result.affPath, spellDicPath: result.dicPath, spellLangName: result.name })
    window.api.spellListInstalled().then(setInstalledDicts)
  }

  const resetToBuiltIn = async () => {
    const { resetToEnglish } = await import('../lib/spellChecker')
    resetToEnglish()
    setActiveLang(BUILT_IN)
    onSaveSettings({ spellAffPath: '', spellDicPath: '', spellLangName: '' })
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement)?.tagName === 'INPUT'
      if (e.key === 'Escape') {
        e.preventDefault()
        if (editing) setEditing(null)
        else if (selected.size) setSelected(new Set())
        else if (query) setQuery('')
        else onClose()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); return }
      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && !inField) { e.preventDefault(); setSelected(new Set(filtered)); return }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !inField && undo?.words) {
        e.preventDefault(); onChangeWords(undo.words); setUndo(null); return
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && !inField && selected.size) {
        e.preventDefault(); removeWords([...selected])
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  if (!open) return null

  const highlight = (word: string) => {
    const term = candidates.length === 1 ? candidates[0] : ''
    const i = term ? word.toLowerCase().indexOf(term) : -1
    if (i < 0) return word
    return <>{word.slice(0, i)}<mark style={{ background: 'rgba(37,99,235,0.18)', color: 'inherit', borderRadius: 2 }}>{word.slice(i, i + term.length)}</mark>{word.slice(i + term.length)}</>
  }

  const chip = (word: string) => {
    const isSel = selected.has(word)
    if (editing?.word === word) {
      return (
        <input
          key={word}
          autoFocus
          value={editing.value}
          onChange={e => setEditing({ word, value: e.target.value })}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commitEdit() }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEditRef.current = true; setEditing(null) }
          }}
          onBlur={commitEdit}
          onFocus={() => { cancelEditRef.current = false }}
          style={{
            fontSize: 12, padding: '3px 8px', borderRadius: 7, width: Math.max(80, editing.value.length * 8 + 20),
            border: '1px solid var(--accent)', outline: 'none', fontFamily: 'inherit', color: 'var(--text)',
            background: '#fff',
          }}
        />
      )
    }
    return (
      <WordChip
        key={word}
        selected={isSel}
        onClick={e => toggleSelect(word, e)}
        onDoubleClick={() => setEditing({ word, value: word })}
        onRemove={() => removeWords([word])}
      >
        {highlight(word)}
      </WordChip>
    )
  }

  const installedOptions = installedDicts.some(d => d.name === activeLang) || activeLang === BUILT_IN
    ? installedDicts
    : [...installedDicts, { id: '__custom', name: activeLang, affPath: '', dicPath: '' }]

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15, 20, 40, 0.35)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '8vh',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.dic,text/plain"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = '' }}
      />
      <div style={{
        width: 620, maxWidth: 'calc(100vw - 48px)', height: '76vh',
        background: 'rgba(250,251,255,0.94)',
        backdropFilter: 'blur(32px) saturate(200%)', WebkitBackdropFilter: 'blur(32px) saturate(200%)',
        border: '1px solid rgba(255,255,255,0.9)', borderRadius: 14,
        boxShadow: '0 24px 64px rgba(0,20,100,0.18), 0 2px 8px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.95)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '14px 18px 10px', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>Dictionary</div>
            <div style={{ fontSize: 11, color: 'var(--subtext)', marginTop: 1 }}>
              {words.length} custom word{words.length === 1 ? '' : 's'} · words here are never flagged as misspelled
            </div>
          </div>
          <button onClick={onClose} title="Close (Esc)"
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, color: 'var(--subtext)', lineHeight: 1 }}>
            ×
          </button>
        </div>

        {/* Language */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          margin: '0 18px 10px', padding: '8px 10px',
          background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 10,
        }}>
          <span style={{ fontSize: 11, color: 'var(--subtext)' }}>Language</span>
          <select
            value={activeLang}
            disabled={langLoading}
            onChange={e => {
              const name = e.target.value
              if (name === BUILT_IN) { resetToBuiltIn(); return }
              const d = installedDicts.find(x => x.name === name)
              if (d) loadDict(d.affPath, d.dicPath, d.name)
            }}
            style={{
              fontSize: 12, padding: '3px 6px', borderRadius: 6, fontFamily: 'inherit',
              border: '1px solid rgba(0,0,0,0.12)', background: '#fff', color: 'var(--text)',
            }}
          >
            <option value={BUILT_IN}>{BUILT_IN}</option>
            {installedOptions.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
          <SmallBtn onClick={pickCustomDict}>Load .aff/.dic…</SmallBtn>
          {langLoading && <span style={{ fontSize: 11, color: 'var(--subtext)' }}>Loading…</span>}
          <span
            title="Install more with: npm install dictionary-<code> (e.g. dictionary-en-au), then restart"
            style={{ fontSize: 10, color: 'var(--overlay)', marginLeft: 'auto', cursor: 'help' }}
          >
            More languages: <code style={{ fontFamily: 'monospace' }}>npm install dictionary-xx</code>
          </span>
          {langError && <div style={{ width: '100%', fontSize: 11, color: 'var(--red)' }}>{langError}</div>}
        </div>

        {/* Search / add */}
        <div style={{ padding: '0 18px 8px', flexShrink: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            border: '1px solid rgba(0,0,0,0.1)', borderRadius: 9, background: '#fff', padding: '6px 10px',
          }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.4 }}>
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitQuery() } }}
              placeholder="Search, or type / paste words to add…"
              spellCheck={false}
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--text)', fontFamily: 'inherit' }}
            />
            {newWords.length > 0 && (
              <button onClick={submitQuery}
                style={{
                  flexShrink: 0, padding: '3px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
                }}>
                {newWords.length === 1 ? `Add "${newWords[0]}"` : `Add ${newWords.length} words`} ↵
              </button>
            )}
            {query && newWords.length === 0 && candidates.length === 1 && wordSet.has(candidates[0]) && (
              <span style={{ fontSize: 11, color: 'var(--green)', flexShrink: 0 }}>✓ In dictionary</span>
            )}
          </div>
        </div>

        {/* Selection bar */}
        {selected.size > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, margin: '0 18px 6px', padding: '5px 10px',
            borderRadius: 8, background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.18)',
            fontSize: 11, color: 'var(--accent)', flexShrink: 0,
          }}>
            <span style={{ fontWeight: 600 }}>{selected.size} selected</span>
            <span style={{ flex: 1 }} />
            <SmallBtn onClick={() => setSelected(new Set(filtered))}>Select all{q ? ' matching' : ''}</SmallBtn>
            <SmallBtn onClick={() => setSelected(new Set())}>Deselect</SmallBtn>
            <SmallBtn danger onClick={() => removeWords([...selected])}>Remove ⌫</SmallBtn>
          </div>
        )}

        {/* Word list */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '10px 18px 14px' }}>
            {words.length === 0 ? (
              <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--subtext)', fontSize: 12, lineHeight: 1.7 }}>
                No custom words yet.<br />
                Type above to add some, right-click a misspelled word in the editor,<br />
                or <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => fileRef.current?.click()}>import a word list</span>.
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--subtext)', fontSize: 12 }}>
                No words match "{query.trim()}". Press ↵ to add it.
              </div>
            ) : showIndex ? (
              groups.map(([letter, list]) => (
                <div key={letter} data-letter={letter} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--overlay)', letterSpacing: '0.06em', marginBottom: 4 }}>{letter}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{list.map(chip)}</div>
                </div>
              ))
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{filtered.map(chip)}</div>
            )}
          </div>
          {showIndex && groups.length > 3 && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
              padding: '8px 6px', borderLeft: '1px solid rgba(0,0,0,0.04)',
            }}>
              {groups.map(([letter]) => (
                <button key={letter}
                  onClick={() => listRef.current?.querySelector(`[data-letter="${letter}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 9, fontWeight: 600, color: 'var(--accent)', padding: '1px 3px', fontFamily: 'inherit' }}>
                  {letter}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px',
          borderTop: '1px solid rgba(0,0,0,0.06)', flexShrink: 0, background: 'rgba(255,255,255,0.4)',
        }}>
          <SmallBtn onClick={() => fileRef.current?.click()}>Import…</SmallBtn>
          <SmallBtn onClick={exportWords} disabled={words.length === 0}>Export…</SmallBtn>
          <span style={{ flex: 1, fontSize: 10, color: 'var(--overlay)', textAlign: 'center' }}>
            {kbd('Click to select · ⌘-click for more · double-click to edit')}
          </span>
          {words.length > 0 && (confirmClear ? (
            <>
              <span style={{ fontSize: 11, color: 'var(--red)' }}>Remove all {words.length}?</span>
              <SmallBtn onClick={() => setConfirmClear(false)}>Cancel</SmallBtn>
              <SmallBtn danger onClick={clearAll}>Clear all</SmallBtn>
            </>
          ) : (
            <SmallBtn onClick={() => setConfirmClear(true)}>Clear all…</SmallBtn>
          ))}
        </div>

        {/* Undo toast */}
        {undo && (
          <div style={{
            position: 'absolute', bottom: 54, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', gap: 12,
            background: 'rgba(0,0,0,0.78)', color: '#fff', borderRadius: 8, padding: '6px 8px 6px 14px',
            fontSize: 12, whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
            animation: 'fadeIn 0.15s ease',
          }}>
            {undo.label}
            {undo.words ? (
              <button
                onClick={() => { if (undo.words) onChangeWords(undo.words); setUndo(null) }}
                style={{ border: 'none', borderRadius: 5, padding: '2px 8px', cursor: 'pointer', background: 'rgba(255,255,255,0.18)', color: '#fff', fontSize: 11, fontWeight: 600, fontFamily: 'inherit' }}>
                Undo
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

function WordChip({ selected, onClick, onDoubleClick, onRemove, children }: {
  selected: boolean
  onClick: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onRemove: () => void
  children: React.ReactNode
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 6px 3px 9px', borderRadius: 7, cursor: 'pointer', userSelect: 'none',
        fontSize: 12, color: selected ? '#fff' : 'var(--text)',
        background: selected ? 'var(--accent)' : hovered ? 'rgba(37,99,235,0.08)' : 'rgba(255,255,255,0.75)',
        border: `1px solid ${selected ? 'var(--accent)' : 'rgba(0,0,0,0.08)'}`,
        transition: 'background 0.08s',
      }}
    >
      <span>{children}</span>
      <button
        onClick={e => { e.stopPropagation(); onRemove() }}
        title="Remove"
        style={{
          border: 'none', background: 'none', cursor: 'pointer', padding: '0 2px', lineHeight: 1,
          fontSize: 10, color: selected ? 'rgba(255,255,255,0.85)' : 'var(--overlay)',
          opacity: hovered || selected ? 1 : 0, fontFamily: 'inherit',
        }}
      >✕</button>
    </div>
  )
}

function SmallBtn({ onClick, children, danger, disabled }: {
  onClick: () => void; children: React.ReactNode; danger?: boolean; disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: danger ? 'rgba(220,38,38,0.10)' : 'rgba(255,255,255,0.7)',
        border: `1px solid ${danger ? 'rgba(220,38,38,0.3)' : 'rgba(0,0,0,0.1)'}`,
        color: danger ? 'var(--red)' : 'var(--subtext)',
        borderRadius: 6, padding: '3px 9px', fontSize: 11, fontFamily: 'inherit',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, whiteSpace: 'nowrap',
      }}
    >{children}</button>
  )
}
