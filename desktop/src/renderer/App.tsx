import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Toolbar } from './components/Toolbar'
import { NoteEditor } from './components/NoteEditor'
import { PreviewPane } from './components/PreviewPane'
import { SettingsPanel } from './components/SettingsPanel'
import { SearchModal } from './components/SearchModal'
import { useNotes } from './hooks/useNotes'
import { useNoteCompiler } from './hooks/useNoteCompiler'
import { useTokenColors } from './hooks/useTokenColors'
import { useServerSync } from './hooks/useServerSync'
import type { AppSettings } from '../../preload/index'

export default function App() {
  // ── State ────────────────────────────────────────────────────────────────────
  const {
    notes, activeNote, isLoading, history,
    selectNote, updateBody, createNote, importNote, deleteNote, refreshNotes, flushSave
  } = useNotes()

  const [settings, setSettings] = useState<AppSettings>({
    syncMode: 'local', serverUrl: '', notesDir: '', fontSize: 14,
    spellAffPath: '', spellDicPath: '', spellLangName: '', authToken: ''
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  const [settingsLoaded, setSettingsLoaded] = useState(false)

  // Load settings on mount — also restore custom spell dict if one was saved
  useEffect(() => {
    window.api.settingsGet().then(s => { setSettings(s); setSettingsLoaded(true) })
    window.api.spellLoadDict().then(result => {
      if (result) {
        import('./lib/spellChecker').then(({ reinitChecker }) => reinitChecker(result.aff, result.dic))
      }
    })
  }, [])

  // ── Token colors ─────────────────────────────────────────────────────────────
  const { colors, updateColor, resetColors, resetOne } = useTokenColors()

  // ── Spell check ──────────────────────────────────────────────────────────────
  const [spellIgnoredNotes, setSpellIgnoredNotes] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('folio-spell-ignored') ?? '[]')) } catch { return new Set() }
  })
  const spellCheckEnabled = !spellIgnoredNotes.has(activeNote?.id ?? '')
  const toggleSpellIgnore = useCallback(() => {
    const id = activeNote?.id
    if (!id) return
    setSpellIgnoredNotes(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      localStorage.setItem('folio-spell-ignored', JSON.stringify([...next]))
      return next
    })
  }, [activeNote?.id])
  const [customDictionary, setCustomDictionary] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('folio-custom-dictionary') ?? '[]') } catch { return [] }
  })
  const handleAddWord = useCallback((word: string) => {
    setCustomDictionary(prev => {
      if (prev.includes(word)) return prev
      const next = [...prev, word].sort()
      localStorage.setItem('folio-custom-dictionary', JSON.stringify(next))
      return next
    })
  }, [])

  const handleRemoveWord = useCallback((word: string) => {
    setCustomDictionary(prev => {
      const next = prev.filter(w => w !== word)
      localStorage.setItem('folio-custom-dictionary', JSON.stringify(next))
      return next
    })
  }, [])

  // ── Compiler ─────────────────────────────────────────────────────────────────
  const body  = activeNote?.body ?? ''
  const title = activeNote?.title ?? ''

  const { pdfBytes, error, isCompiling, compile } = useNoteCompiler(body)

  // ── Server sync ───────────────────────────────────────────────────────────────
  const { status: syncStatus, pushNote, syncAll, deleteNote: deleteNoteOnServer, uploadAttachment } = useServerSync(
    settings.serverUrl,
    settings.syncMode === 'server',
    settings.authToken
  )

  // Two-way sync once settings are loaded, and on window focus
  useEffect(() => {
    if (!settingsLoaded || settings.syncMode !== 'server') return
    syncAll().then(result => { if (result === 'synced') refreshNotes() })
  }, [settingsLoaded, settings.syncMode, settings.serverUrl, settings.authToken])

  useEffect(() => {
    if (!settingsLoaded || settings.syncMode !== 'server') return
    const handler = () => syncAll().then(result => { if (result === 'synced') refreshNotes() })
    window.addEventListener('focus', handler)
    return () => window.removeEventListener('focus', handler)
  }, [settingsLoaded, settings.syncMode, settings.serverUrl, syncAll])

  // ── Dirty tracking ────────────────────────────────────────────────────────────
  const prevBodyRef = useRef(body)
  useEffect(() => {
    if (body !== prevBodyRef.current) {
      prevBodyRef.current = body
      setIsDirty(true)
      setLastSaved(null)
    }
  }, [body])

  useEffect(() => {
    if (!isDirty) return
    const t = setTimeout(() => {
      setIsDirty(false)
      setLastSaved(new Date())
      if (activeNote && settings.syncMode === 'server') {
        pushNote(activeNote.id, activeNote.body)
      }
    }, 2100)
    return () => clearTimeout(t)
  }, [body]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Body change handler ───────────────────────────────────────────────────────
  const handleBodyChange = useCallback((newBody: string) => {
    updateBody(newBody)
  }, [updateBody])

  // ── Image attachment ─────────────────────────────────────────────────────────

  /** Open file picker, save locally, upload to server if needed. Returns filename or null. */
  const handlePickImage = useCallback(async (): Promise<string | null> => {
    const noteId = activeNote?.id
    if (!noteId) return null
    const result = await window.api.attachmentsPickAndSave(noteId)
    if (!result || 'error' in result) return null
    // Upload in background — don't block text insertion on server round-trip
    if (settings.syncMode === 'server') uploadAttachment(noteId, result.filename)
    return result.filename
  }, [activeNote, settings.syncMode, uploadAttachment])

  const handleDropImage = useCallback(async (srcPath: string): Promise<string | null> => {
    const noteId = activeNote?.id
    if (!noteId) return null
    const result = await window.api.attachmentsSaveFile(noteId, srcPath)
    if ('error' in result) return null
    if (settings.syncMode === 'server') uploadAttachment(noteId, result.filename)
    return result.filename
  }, [activeNote, settings.syncMode, uploadAttachment])

  // ── Navigate to note by title (wiki links) ───────────────────────────────────
  const handleNavigate = useCallback((title: string) => {
    const target = notes.find(n => n.title.toLowerCase() === title.toLowerCase())
    if (target) selectNote(target)
  }, [notes, selectNote])

  // ── Create/delete ─────────────────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    const note = await createNote()
    setSearchOpen(false)
    return note
  }, [createNote])

  const handleDelete = useCallback(async (filePath: string) => {
    const noteId = notes.find(n => n.filePath === filePath)?.id
    await deleteNote(filePath)
    if (noteId && settings.syncMode === 'server') await deleteNoteOnServer(noteId)
    setSearchOpen(true) // reopen explorer so user can pick another note
  }, [deleteNote, deleteNoteOnServer, notes, settings.syncMode])

  // ── Share source ─────────────────────────────────────────────────────────────
  const handleShareSource = useCallback(async () => {
    if (!activeNote) return
    await flushSave()
    await window.api.notesShareSource(activeNote.id, activeNote.filePath)
  }, [activeNote, flushSave])

  // ── Export PDF ────────────────────────────────────────────────────────────────
  const exportPdf = useCallback(async () => {
    if (!pdfBytes || !activeNote) return
    await flushSave()
    const name = `${activeNote.id}.pdf`
    await window.api.notesExportPdf(Array.from(pdfBytes), name)
  }, [pdfBytes, activeNote, flushSave])

  // ── Menu events ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsubs = [
      window.api.onMenuNew(handleCreate),
      window.api.onMenuDelete(() => { if (activeNote) handleDelete(activeNote.filePath) }),
      window.api.onMenuExportPdf(exportPdf),
      window.api.onMenuRerender(compile),
      window.api.onMenuShareSource(handleShareSource),
      window.api.onMenuImport(() => { importNote() }),
    ]
    return () => unsubs.forEach(fn => fn())
  }, [handleCreate, handleDelete, exportPdf, compile, activeNote, importNote])

  // ── Cmd+K to open notes explorer, Cmd+1/2/3 for navigation history ──────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setSearchOpen(v => !v)
        return
      }
      if ((e.metaKey || e.ctrlKey) && ['1', '2', '3'].includes(e.key)) {
        e.preventDefault()
        const idx = parseInt(e.key) - 1
        const targetId = history[idx]
        if (targetId) {
          const target = notes.find(n => n.id === targetId)
          if (target) selectNote(target)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [history, notes, selectNote])

  // Open explorer on load if no note is selected
  useEffect(() => {
    if (!isLoading && !activeNote) setSearchOpen(true)
  }, [isLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save settings ─────────────────────────────────────────────────────────────
  const handleSaveSettings = useCallback(async (partial: Partial<AppSettings>) => {
    const updated = { ...settings, ...partial }
    setSettings(updated)
    await window.api.settingsSet(updated)
    await refreshNotes()
  }, [settings, refreshNotes])

  // ── Split pane ────────────────────────────────────────────────────────────────
  const [splitPct, setSplitPct] = useState(50)
  const dragging = useRef(false)
  const splitContainerRef = useRef<HTMLDivElement>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); dragging.current = true
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !splitContainerRef.current) return
      const rect = splitContainerRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setSplitPct(Math.min(95, Math.max(5, pct)))
    }
    const onUp = () => { dragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Toolbar
        noteTitle={activeNote?.title ?? ''}
        isDirty={isDirty}
        isCompiling={isCompiling}
        hasError={!!error}
        hasPdf={!!pdfBytes}
        lastSaved={lastSaved}
        syncMode={settings.syncMode}
        syncStatus={syncStatus}
        hasActiveNote={!!activeNote}
        onShare={(kind) => kind === 'pdf' ? exportPdf() : handleShareSource()}
        onSettings={() => setSettingsOpen(v => !v)}
        onOpenNotes={() => setSearchOpen(true)}
      />

      <div ref={splitContainerRef} style={{
        flex: 1, display: 'flex', overflow: 'hidden',
        padding: '10px', gap: 0,
      }}>
        {/* Editor — hidden when splitPct === 0 (preview fullscreen) */}
        {splitPct > 0 && (
          <div style={{
            width: splitPct >= 100 ? '100%' : `calc(${splitPct}% - 5px)`,
            display: 'flex', overflow: 'visible', position: 'relative',
            borderRadius: 'var(--radius)',
            background: 'rgba(255,255,255,0.72)',
            border: '1px solid var(--glass-border)',
            boxShadow: 'var(--glass-shadow), inset 0 1px 0 rgba(255,255,255,0.95)',
          }}>
            <ExpandBtn title={splitPct >= 100 ? 'Restore split' : 'Fullscreen editor'} onClick={() => setSplitPct(v => v >= 100 ? 50 : 100)} />
            {activeNote ? (
              <NoteEditor
                value={activeNote.body}
                onChange={handleBodyChange}
                tokenColors={colors}
                fontSize={settings.fontSize}
                spellCheckEnabled={spellCheckEnabled}
                onToggleSpellIgnore={toggleSpellIgnore}
                customDictionary={customDictionary}
                onAddToDict={handleAddWord}
                notes={notes}
                onNavigate={handleNavigate}
                noteId={activeNote.id}
                onPickImage={handlePickImage}
                onDropImage={handleDropImage}
              />
            ) : (
              <EmptyState onOpen={() => setSearchOpen(true)} isLoading={isLoading} />
            )}
            <FontSizeControl
              fontSize={settings.fontSize}
              onChange={fs => handleSaveSettings({ fontSize: fs })}
            />
          </div>
        )}

        {/* Divider — hidden when either pane is fullscreen */}
        {splitPct > 0 && splitPct < 100 && (
          <div
            onMouseDown={onMouseDown}
            onDoubleClick={() => setSplitPct(50)}
            style={{
              width: 10, flexShrink: 0, cursor: 'col-resize',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div style={{
              width: 2, height: 48, borderRadius: 2,
              background: 'rgba(255,255,255,0.7)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            }} />
          </div>
        )}

        {/* Preview — hidden when splitPct === 100 (editor fullscreen) */}
        {splitPct < 100 && (
          <div style={{
            flex: 1, display: 'flex', overflow: 'hidden', position: 'relative',
            borderRadius: 'var(--radius)',
            background: 'rgba(255,255,255,0.45)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            border: '1px solid var(--glass-border)',
            boxShadow: 'var(--glass-shadow), inset 0 1px 0 rgba(255,255,255,0.95)',
          }}>
            <ExpandBtn title={splitPct <= 0 ? 'Restore split' : 'Fullscreen preview'} onClick={() => setSplitPct(v => v <= 0 ? 50 : 0)} />
            <PreviewPane pdfBytes={pdfBytes} error={error} isCompiling={isCompiling} />
          </div>
        )}
      </div>

      <SearchModal
        open={searchOpen}
        notes={notes}
        activeNoteId={activeNote?.id ?? null}
        onClose={() => setSearchOpen(false)}
        onSelect={async (note) => { await selectNote(note) }}
        onCreate={handleCreate}
        onDelete={handleDelete}
      />

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
        colors={colors}
        onColorChange={updateColor}
        onResetOne={resetOne}
        onResetAll={resetColors}
        customDictionary={customDictionary}
        onRemoveWord={handleRemoveWord}
      />
    </div>
  )
}

function FontSizeControl({ fontSize, onChange }: { fontSize: number; onChange: (fs: number) => void }) {
  return (
    <div style={{
      position: 'absolute', bottom: 10, right: 10,
      display: 'flex', alignItems: 'center', gap: 6,
      background: 'rgba(255,255,255,0.7)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      border: '1px solid rgba(255,255,255,0.8)',
      borderRadius: 20,
      padding: '3px 10px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      <button
        onClick={() => onChange(Math.max(10, fontSize - 1))}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--subtext)', fontSize: 14, lineHeight: 1, padding: '0 2px', fontFamily: 'inherit' }}
      >−</button>
      <span style={{ fontSize: 11, color: 'var(--subtext)', minWidth: 28, textAlign: 'center', userSelect: 'none' }}>{fontSize}px</span>
      <button
        onClick={() => onChange(Math.min(24, fontSize + 1))}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--subtext)', fontSize: 14, lineHeight: 1, padding: '0 2px', fontFamily: 'inherit' }}
      >+</button>
    </div>
  )
}

function ExpandBtn({ onClick, title }: { onClick: () => void; title: string }) {
  const [hovered, setHovered] = React.useState(false)
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'absolute', top: 8, right: 8, zIndex: 10,
        background: 'transparent', border: 'none', cursor: 'pointer',
        padding: 4, borderRadius: 4,
        opacity: hovered ? 1 : 0.5,
        color: 'var(--subtext)',
        fontSize: 14, lineHeight: 1,
        transition: 'opacity 0.15s',
      }}
    >⤢</button>
  )
}

function EmptyState({ onOpen, isLoading }: { onOpen: () => void; isLoading: boolean }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 12, color: 'var(--overlay)',
    }}>
      {isLoading ? (
        <div style={{
          width: 20, height: 20, borderRadius: '50%',
          border: '2px solid rgba(37,99,235,0.15)',
          borderTopColor: 'var(--accent)',
          animation: 'spin 0.7s linear infinite',
        }} />
      ) : (
        <>
          <span style={{ fontSize: 13 }}>No note open</span>
          <button
            onClick={onOpen}
            style={{
              background: 'rgba(37,99,235,0.10)',
              border: '1px solid rgba(37,99,235,0.2)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 16px', fontSize: 12,
              color: 'var(--accent)', cursor: 'pointer',
            }}
          >Browse Notes (⌘K)</button>
        </>
      )}
    </div>
  )
}
