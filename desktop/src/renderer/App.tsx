import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Toolbar } from './components/Toolbar'
import { NoteEditor } from './components/NoteEditor'
import { PreviewPane } from './components/PreviewPane'
import { SettingsPanel } from './components/SettingsPanel'
import { SearchModal } from './components/SearchModal'
import { RemindersPanel } from './components/RemindersPanel'
import { DictionaryModal } from './components/DictionaryModal'
import { TabStrip } from './components/TabStrip'
import { useNotes } from './hooks/useNotes'
import { useNoteCompiler } from './hooks/useNoteCompiler'
import { useTokenColors } from './hooks/useTokenColors'
import { useServerSync } from './hooks/useServerSync'
import { useReminders } from './hooks/useReminders'
import { reminderGroup, toLocalISOString } from './lib/reminderTime'
import type { AppSettings } from '../../preload/index'
import type { NoteMeta } from './hooks/useNotes'
import { kbd, isMac } from './lib/kbd'

// Extra windows are opened with ?window=secondary&note=<id>. Only the main
// window remembers its tabs between launches.
const WINDOW_PARAMS = new URLSearchParams(window.location.search)
const IS_SECONDARY = WINDOW_PARAMS.get('window') === 'secondary'
const TABS_KEY = 'folio-open-tabs'
const ACTIVE_TAB_KEY = 'folio-active-tab'

function loadStoredTabs(): string[] {
  if (IS_SECONDARY) {
    const id = WINDOW_PARAMS.get('note')
    return id ? [id] : []
  }
  try { return JSON.parse(localStorage.getItem(TABS_KEY) ?? '[]') } catch { return [] }
}

export default function App() {
  // ── State ────────────────────────────────────────────────────────────────────
  const {
    notes, activeNote, isLoading, history, bibEntries,
    selectNote, closeNote, updateBody, createNote, importNote, deleteNote, refreshNotes, flushSave
  } = useNotes()

  const [settings, setSettings] = useState<AppSettings>({
    syncMode: 'local', serverUrl: '', notesDir: '', fontSize: 14,
    spellAffPath: '', spellDicPath: '', spellLangName: '', authToken: '',
    citationStyle: 'author-date', runInBackground: true, openAtLogin: false, showTabs: true,
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [remindersOpen, setRemindersOpen] = useState(false)
  const [dictionaryOpen, setDictionaryOpen] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [focusTitleKey, setFocusTitleKey] = useState(0)
  const [countMode, setCountMode] = useState<'words' | 'chars'>('words')
  const [selectedText, setSelectedText] = useState('')

  const [settingsLoaded, setSettingsLoaded] = useState(false)

  // Load settings on mount — also restore custom spell dict if one was saved
  useEffect(() => {
    window.api.settingsGet().then(s => { setSettings(s); setSettingsLoaded(true) })
    // Another window saved settings — pick them up here too
    const unsub = window.api.onSettingsChanged(setSettings)
    window.api.spellLoadDict().then(result => {
      if (result) {
        import('./lib/spellChecker').then(({ reinitChecker }) => reinitChecker(result.aff, result.dic))
      }
    })
    return unsub
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

  // Replace the whole list (dictionary modal): dedupe case-insensitively, sort, persist
  const handleSetWords = useCallback((words: string[]) => {
    const seen = new Set<string>()
    const next = words.filter(w => {
      const k = w.toLowerCase()
      if (!w || seen.has(k)) return false
      seen.add(k)
      return true
    }).sort((a, b) => a.localeCompare(b))
    localStorage.setItem('folio-custom-dictionary', JSON.stringify(next))
    setCustomDictionary(next)
  }, [])

  // ── Compiler ─────────────────────────────────────────────────────────────────
  const body  = activeNote?.body ?? ''
  const title = activeNote?.title ?? ''

  const { pdfBytes, error, diagnostics, isCompiling, compile } = useNoteCompiler(body)

  // Clicking an error in the preview moves the editor cursor there
  const [jumpTo, setJumpTo] = useState<{ line: number; column: number; key: number } | null>(null)
  const handleJumpToError = useCallback((line: number, column: number) => {
    // Bring the editor back if the preview is fullscreen
    setSplitPct(v => (v <= 0 ? 50 : v))
    setJumpTo({ line, column, key: Date.now() })
  }, [])

  const displayCount = useMemo(() => {
    const base = selectedText !== '' ? selectedText : body
    return countMode === 'words' ? wordCount(base) : charCount(base)
  }, [selectedText, body, countMode])

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

  // Periodic background sync so reminders/notes set on other devices land
  // without waiting for a focus event. Skipped when the window is hidden.
  useEffect(() => {
    if (!settingsLoaded || settings.syncMode !== 'server' || IS_SECONDARY) return
    const id = setInterval(() => {
      if (document.hidden) return
      syncAll().then(result => { if (result === 'synced') refreshNotes() })
    }, 60_000)
    return () => clearInterval(id)
  }, [settingsLoaded, settings.syncMode, settings.serverUrl, settings.authToken, syncAll, refreshNotes])

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

  useEffect(() => { setSelectedText('') }, [activeNote?.id])

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

  const handlePasteImage = useCallback(async (bytes: Uint8Array, ext: string): Promise<string | null> => {
    const noteId = activeNote?.id
    if (!noteId) return null
    const filename = `${Date.now()}.${ext}`
    let b64 = ''
    const chunkSize = 8192
    for (let i = 0; i < bytes.length; i += chunkSize)
      b64 += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    b64 = btoa(b64)
    const res = await window.api.attachmentsWrite(noteId, filename, b64)
    if ('error' in res) return null
    if (settings.syncMode === 'server') uploadAttachment(noteId, filename)
    return filename
  }, [activeNote, settings.syncMode, uploadAttachment])

  // ── Navigate to note by title (wiki links) ───────────────────────────────────
  const handleNavigate = useCallback((title: string) => {
    const target = notes.find(n => n.title.toLowerCase() === title.toLowerCase())
    if (target) selectNote(target)
  }, [notes, selectNote])

  // ── Reminders ────────────────────────────────────────────────────────────────
  const reminders = useReminders()
  const reminderBadge = useMemo(() => reminders.filter(r => {
    const g = reminderGroup(new Date(r.scheduledAt))
    return g === 'Overdue' || g === 'Today'
  }).length, [reminders])

  // Notification clicks can arrive before the notes list has loaded — hold the
  // id until the note is available.
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null)
  useEffect(() => window.api.onReminderOpen(id => {
    setPendingOpenId(id)
    setSearchOpen(false)
    setRemindersOpen(false)
  }), [])
  useEffect(() => {
    if (!pendingOpenId) return
    const target = notes.find(n => n.id === pendingOpenId)
    if (target) { setPendingOpenId(null); setSearchOpen(false); selectNote(target) }
  }, [pendingOpenId, notes, selectNote])

  const handleOpenNoteById = useCallback((noteId: string) => {
    const target = notes.find(n => n.id === noteId)
    if (target) selectNote(target)
  }, [notes, selectNote])

  const handleReminderUpdate = useCallback(async (noteId: string, date: Date | null) => {
    // Persist pending edits first so the main process rewrites the latest body
    if (activeNote?.id === noteId) await flushSave()
    await window.api.reminderUpdateNote(noteId, date ? toLocalISOString(date) : null)
  }, [activeNote, flushSave])

  // ── Create/delete ─────────────────────────────────────────────────────────────
  // Read by handleDelete, which is defined before the tab state below
  const openTabsRef = useRef<string[]>([])
  const showTabsRef = useRef(true)

  const handleCreate = useCallback(async () => {
    const note = await createNote()
    setSearchOpen(false)
    setFocusTitleKey(k => k + 1)
    return note
  }, [createNote])

  const handleDelete = useCallback(async (filePath: string) => {
    const noteId = notes.find(n => n.filePath === filePath)?.id
    const wasActive = activeNote?.filePath === filePath
    // With tabs on, deleting the open note moves to a neighbouring tab
    const tabIdx = noteId ? openTabsRef.current.indexOf(noteId) : -1
    const neighbourId = tabIdx >= 0
      ? (openTabsRef.current[tabIdx + 1] ?? openTabsRef.current[tabIdx - 1])
      : undefined
    await deleteNote(filePath)
    if (noteId && settings.syncMode === 'server') await deleteNoteOnServer(noteId)
    const neighbour = neighbourId ? notes.find(n => n.id === neighbourId) : undefined
    if (wasActive && showTabsRef.current && neighbour) selectNote(neighbour)
    else if (wasActive) setSearchOpen(true) // reopen explorer so user can pick another note
  }, [deleteNote, deleteNoteOnServer, notes, settings.syncMode, activeNote, selectNote])

  // ── Tabs ──────────────────────────────────────────────────────────────────────
  const showTabs = settings.showTabs ?? true
  const [openTabs, setOpenTabs] = useState<string[]>(loadStoredTabs)
  openTabsRef.current = openTabs
  showTabsRef.current = showTabs

  // Whatever note becomes active gets a tab (search, wiki links, reminders…)
  useEffect(() => {
    const id = activeNote?.id
    if (id) setOpenTabs(prev => (prev.includes(id) ? prev : [...prev, id]))
  }, [activeNote?.id])

  // Drop tabs whose note was deleted (here, in another window, or by sync)
  useEffect(() => {
    if (isLoading) return
    const ids = new Set(notes.map(n => n.id))
    setOpenTabs(prev => (prev.every(id => ids.has(id)) ? prev : prev.filter(id => ids.has(id))))
  }, [notes, isLoading])

  useEffect(() => {
    if (IS_SECONDARY) return
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify(openTabs))
      if (activeNote) localStorage.setItem(ACTIVE_TAB_KEY, activeNote.id)
    } catch {}
  }, [openTabs, activeNote?.id])

  const tabNotes = useMemo(() => {
    const byId = new Map(notes.map(n => [n.id, n]))
    return openTabs.map(id => byId.get(id)).filter((n): n is NoteMeta => !!n)
  }, [openTabs, notes])

  const handleCloseTab = useCallback((id: string) => {
    const idx = openTabs.indexOf(id)
    const rest = openTabs.filter(t => t !== id)
    setOpenTabs(rest)
    if (activeNote?.id !== id) return
    // Closing the active tab moves to its neighbour (prefer the one below)
    const nextId = rest[Math.min(idx, rest.length - 1)]
    const next = nextId ? notes.find(n => n.id === nextId) : undefined
    if (next) selectNote(next)
    else closeNote()
  }, [openTabs, activeNote?.id, notes, selectNote, closeNote])

  const handleCloseOtherTabs = useCallback((id: string) => {
    setOpenTabs([id])
    if (activeNote?.id !== id) {
      const target = notes.find(n => n.id === id)
      if (target) selectNote(target)
    }
  }, [activeNote?.id, notes, selectNote])

  const handleReorderTab = useCallback((fromId: string, toIndex: number) => {
    setOpenTabs(prev => {
      const from = prev.indexOf(fromId)
      if (from < 0) return prev
      const next = prev.filter(t => t !== fromId)
      next.splice(toIndex > from ? toIndex - 1 : toIndex, 0, fromId)
      return next
    })
  }, [])

  const handleOpenInWindow = useCallback(async (id: string) => {
    if (activeNote?.id === id) await flushSave()
    window.api.windowOpenNote(id)
  }, [activeNote?.id, flushSave])

  // ⌘W closes the active tab; with no tab to close it closes the window
  const handleCloseTabOrWindow = useCallback(() => {
    if (showTabs && activeNote) handleCloseTab(activeNote.id)
    else window.api.windowClose()
  }, [showTabs, activeNote, handleCloseTab])

  // Ctrl+Tab / Ctrl+Shift+Tab and ⌘⇧] / ⌘⇧[ cycle through tabs. Capture phase
  // so Monaco doesn't swallow them first.
  useEffect(() => {
    if (!showTabs) return
    const handler = (e: KeyboardEvent) => {
      let dir = 0
      if (e.ctrlKey && !e.metaKey && e.key === 'Tab') dir = e.shiftKey ? -1 : 1
      else if ((isMac ? e.metaKey : e.ctrlKey) && e.shiftKey && (e.code === 'BracketRight' || e.code === 'BracketLeft')) dir = e.code === 'BracketRight' ? 1 : -1
      if (!dir || tabNotes.length < 2) return
      e.preventDefault()
      e.stopPropagation()
      const idx = tabNotes.findIndex(n => n.id === activeNote?.id)
      selectNote(tabNotes[(idx + dir + tabNotes.length) % tabNotes.length])
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [showTabs, tabNotes, activeNote?.id, selectNote])

  // ── Share source ─────────────────────────────────────────────────────────────
  const handleShareSource = useCallback(async () => {
    if (!activeNote) return
    await flushSave()
    await window.api.notesShareSource(activeNote.id, activeNote.filePath)
  }, [activeNote, flushSave])

  // ── Export PDF ────────────────────────────────────────────────────────────────
  // Recompiles against full-resolution images rather than reusing the (possibly
  // downscaled-for-preview) `pdfBytes` already on screen.
  const exportPdf = useCallback(async () => {
    if (!activeNote) return
    await flushSave()
    const result = await window.api.typstCompileNoteForExport(activeNote.body)
    if (!('pdfBytes' in result)) return
    const name = `${activeNote.id}.pdf`
    await window.api.notesExportPdf(Array.from(result.pdfBytes), name)
  }, [activeNote, flushSave])

  // ── Export Word (.docx) ─────────────────────────────────────────────────────
  const exportDocx = useCallback(async () => {
    if (!activeNote) return
    await flushSave()
    const name = `${activeNote.id}.docx`
    await window.api.notesExportDocx(activeNote.filePath, name)
  }, [activeNote, flushSave])

  // ── Menu events ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsubs = [
      window.api.onMenuNew(handleCreate),
      window.api.onMenuDelete(() => { if (activeNote) handleDelete(activeNote.filePath) }),
      window.api.onMenuExportPdf(exportPdf),
      window.api.onMenuExportDocx(exportDocx),
      window.api.onMenuRerender(compile),
      window.api.onMenuShareSource(handleShareSource),
      window.api.onMenuImport(() => { importNote() }),
      window.api.onMenuReminders(() => setRemindersOpen(v => !v)),
      window.api.onMenuDictionary(() => setDictionaryOpen(v => !v)),
      window.api.onMenuCloseTab(handleCloseTabOrWindow),
    ]
    return () => unsubs.forEach(fn => fn())
  }, [handleCreate, handleDelete, exportPdf, exportDocx, compile, activeNote, importNote, handleCloseTabOrWindow])

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

  // On load, reopen the note this window was opened for (extra windows) or the
  // last active tab (main window, tabs on); otherwise show the explorer.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (isLoading || !settingsLoaded || restoredRef.current) return
    restoredRef.current = true
    if (activeNote) return
    let restoreId: string | null = null
    if (IS_SECONDARY) restoreId = WINDOW_PARAMS.get('note')
    else if (settings.showTabs ?? true) {
      try { restoreId = localStorage.getItem(ACTIVE_TAB_KEY) } catch {}
    }
    const target = restoreId ? notes.find(n => n.id === restoreId) : undefined
    if (target) selectNote(target)
    else setSearchOpen(true)
  }, [isLoading, settingsLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save settings ─────────────────────────────────────────────────────────────
  const handleSaveSettings = useCallback(async (partial: Partial<AppSettings>) => {
    const updated = { ...settings, ...partial }
    setSettings(updated)
    await window.api.settingsSet(updated)
    await refreshNotes()
    // citationStyle is read on the main process side at compile time, not
    // passed as part of `body` — recompile only once the new value is
    // confirmed persisted, so the live preview picks it up immediately
    // instead of waiting for the next edit.
    if ('citationStyle' in partial) compile()
  }, [settings, refreshNotes, compile])

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
        onShare={(kind) => kind === 'pdf' ? exportPdf() : kind === 'docx' ? exportDocx() : handleShareSource()}
        onSettings={() => setSettingsOpen(v => !v)}
        onOpenNotes={() => setSearchOpen(true)}
        onReminders={() => setRemindersOpen(v => !v)}
        reminderBadge={reminderBadge}
      />

      <div style={{
        flex: 1, display: 'flex', overflow: 'hidden',
        padding: '10px', gap: 0,
      }}>
        {showTabs && (
          <TabStrip
            tabs={tabNotes}
            activeId={activeNote?.id ?? null}
            activeTitle={activeNote?.title ?? ''}
            onSelect={selectNote}
            onClose={handleCloseTab}
            onReorder={handleReorderTab}
            onOpenInWindow={handleOpenInWindow}
            onCloseOthers={handleCloseOtherTabs}
            onNew={handleCreate}
          />
        )}

        <div ref={splitContainerRef} style={{ flex: 1, minWidth: 0, display: 'flex' }}>
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
            <ExpandBtn expanded={splitPct >= 100} title={splitPct >= 100 ? 'Restore split' : 'Fullscreen editor'} onClick={() => setSplitPct(v => v >= 100 ? 50 : 100)} />
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
                bibEntries={bibEntries}
                onNavigate={handleNavigate}
                noteId={activeNote.id}
                onPickImage={handlePickImage}
                onDropImage={handleDropImage}
                onPasteImage={handlePasteImage}
                focusTitleKey={focusTitleKey}
                onSelectionChange={setSelectedText}
                diagnostics={diagnostics}
                jumpTo={jumpTo}
              />
            ) : (
              <EmptyState onOpen={() => setSearchOpen(true)} isLoading={isLoading} />
            )}
            {activeNote && (
              <div
                onClick={() => setCountMode(m => m === 'words' ? 'chars' : 'words')}
                title={`Click to show ${countMode === 'words' ? 'character' : 'word'} count`}
                style={{
                  position: 'absolute', bottom: 10, left: 10,
                  fontSize: 11, color: 'var(--subtext)',
                  background: 'rgba(255,255,255,0.7)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: '1px solid rgba(255,255,255,0.8)',
                  borderRadius: 20,
                  padding: '3px 10px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                  userSelect: 'none',
                  cursor: 'pointer',
                }}
              >
                {(() => {
                  const unit = countMode === 'words' ? 'words' : 'chars'
                  const pfx  = selectedText !== '' ? 'selected ' : ''
                  return `${displayCount.toLocaleString()} ${pfx}${unit}`
                })()}
              </div>
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
            <ExpandBtn expanded={splitPct <= 0} title={splitPct <= 0 ? 'Restore split' : 'Fullscreen preview'} onClick={() => setSplitPct(v => v <= 0 ? 50 : 0)} />
            <PreviewPane pdfBytes={pdfBytes} error={error} diagnostics={diagnostics} isCompiling={isCompiling} noteId={activeNote?.id} onJumpToError={handleJumpToError} />
          </div>
        )}
        </div>
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

      <RemindersPanel
        open={remindersOpen}
        reminders={reminders}
        onClose={() => setRemindersOpen(false)}
        onOpenNote={handleOpenNoteById}
        onUpdate={handleReminderUpdate}
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
        customWordCount={customDictionary.length}
        onOpenDictionary={() => setDictionaryOpen(true)}
      />

      <DictionaryModal
        open={dictionaryOpen}
        onClose={() => setDictionaryOpen(false)}
        words={customDictionary}
        onChangeWords={handleSetWords}
        spellLangName={settings.spellLangName}
        onSaveSettings={handleSaveSettings}
      />
    </div>
  )
}

function wordCount(body: string): number {
  const text = body
    .split('\n')
    .filter(l => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('#'))
    .join(' ')
    .replace(/={1,6}\s/g, ' ')
    .replace(/[*_`[\]()]/g, ' ')
  return text.trim() ? text.trim().split(/\s+/).filter(s => /\w/.test(s)).length : 0
}

function charCount(body: string): number {
  return body.length
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

function ExpandBtn({ onClick, title, expanded }: { onClick: () => void; title: string; expanded: boolean }) {
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
        lineHeight: 0,
        transition: 'opacity 0.15s',
      }}
    >
      {/* Arrows point out to expand, in to restore the split */}
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {expanded ? (
          <>
            <path d="M14 2L9.5 6.5M9.5 3v3.5H13" />
            <path d="M2 14l4.5-4.5M6.5 13V9.5H3" />
          </>
        ) : (
          <>
            <path d="M9.5 6.5L14 2M10.5 2H14v3.5" />
            <path d="M6.5 9.5L2 14M5.5 14H2v-3.5" />
          </>
        )}
      </svg>
    </button>
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
          >{kbd('Browse Notes (⌘K)')}</button>
        </>
      )}
    </div>
  )
}
