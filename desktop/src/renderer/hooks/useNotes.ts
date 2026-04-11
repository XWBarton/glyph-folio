import { useState, useCallback, useEffect, useRef } from 'react'

// Navigation history: array of note IDs, most recently visited first (excluding current)

export interface NoteMeta {
  id: string
  title: string
  tags: string[]
  links: string[]
  createdAt: string
  modifiedAt: string
  filePath: string
}

export interface Note extends NoteMeta {
  body: string
}

interface State {
  notes: NoteMeta[]
  activeNote: Note | null
  isLoading: boolean
}

const AUTO_SAVE_DELAY = 2000

export function useNotes() {
  const [state, setState] = useState<State>({
    notes: [],
    activeNote: null,
    isLoading: true
  })
  const [history, setHistory] = useState<string[]>([])

  const stateRef = useRef(state)
  stateRef.current = state
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef(false)

  // ── Load notes list ─────────────────────────────────────────────────────────

  const refreshNotes = useCallback(async () => {
    const notes = await window.api.notesList()
    setState(s => ({ ...s, notes, isLoading: false }))
  }, [])

  useEffect(() => {
    refreshNotes()
  }, [refreshNotes])

  // ── Listen for external file changes (iCloud / server sync arriving) ────────

  useEffect(() => {
    return window.api.onNotesChanged(async (_event, changedPath) => {
      await refreshNotes()
      // If the currently active note changed externally, reload its body
      const active = stateRef.current.activeNote
      if (active && active.filePath === changedPath) {
        const fresh = await window.api.notesRead(changedPath)
        if (fresh) {
          setState(s => ({
            ...s,
            activeNote: s.activeNote?.filePath === changedPath ? fresh : s.activeNote
          }))
        }
      }
    })
  }, [refreshNotes])

  // ── Auto-save active note 2s after last change ───────────────────────────

  const scheduleAutoSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      const active = stateRef.current.activeNote
      if (!active || !dirtyRef.current) return
      dirtyRef.current = false
      // Capture old title (from notes list, which still has the pre-edit title)
      const oldTitle = stateRef.current.notes.find(n => n.filePath === active.filePath)?.title
      await window.api.notesWrite(active.filePath, active.body)
      // If title changed, rename [[Old Title]] → [[New Title]] in all other notes
      if (oldTitle && active.title && oldTitle !== active.title) {
        await window.api.notesRenameLinks(oldTitle, active.title, active.filePath)
      }
      // Refresh list so modifiedAt + title updates propagate
      const notes = await window.api.notesList()
      setState(s => ({ ...s, notes }))
    }, AUTO_SAVE_DELAY)
  }, [])

  // ── Select / load a note ────────────────────────────────────────────────────

  const selectNote = useCallback(async (meta: NoteMeta) => {
    // Flush pending save for current note before switching
    const active = stateRef.current.activeNote
    if (dirtyRef.current) {
      if (active) {
        dirtyRef.current = false
        if (timerRef.current) clearTimeout(timerRef.current)
        await window.api.notesWrite(active.filePath, active.body)
      }
    }
    // Push previous note to history (most recent first, cap at 10, skip if same)
    if (active && active.id !== meta.id) {
      setHistory(prev => [active.id, ...prev.filter(id => id !== meta.id)].slice(0, 10))
    }
    const note = await window.api.notesRead(meta.filePath)
    if (note) setState(s => ({ ...s, activeNote: note }))
  }, [])

  // ── Update body (called on every editor change) ─────────────────────────────

  const updateBody = useCallback((body: string) => {
    dirtyRef.current = true
    setState(s => {
      if (!s.activeNote) return s
      const override = body.match(/^\/\/\s*=\s+(.+)$/m)
      const heading  = body.match(/^={1,6}\s+(.+)$/m)
      const title = override ? override[1].trim() : heading ? heading[1].trim() : s.activeNote.title
      return { ...s, activeNote: { ...s.activeNote, body, title } }
    })
    scheduleAutoSave()
  }, [scheduleAutoSave])

  // ── Create note ─────────────────────────────────────────────────────────────

  const createNote = useCallback(async (title?: string) => {
    const note = await window.api.notesCreate(title)
    const notes = await window.api.notesList()
    setState(s => ({ ...s, notes, activeNote: note }))
    return note
  }, [])

  // ── Delete note ─────────────────────────────────────────────────────────────

  const deleteNote = useCallback(async (filePath: string) => {
    await window.api.notesDelete(filePath)
    const notes = await window.api.notesList()
    setState(s => ({
      ...s,
      notes,
      activeNote: s.activeNote?.filePath === filePath
        ? (notes[0] ? null : null)  // clear; caller can auto-select first
        : s.activeNote
    }))
    return notes
  }, [])

  // ── Flush save immediately (e.g. before export) ─────────────────────────────

  const flushSave = useCallback(async () => {
    const active = stateRef.current.activeNote
    if (!active || !dirtyRef.current) return
    dirtyRef.current = false
    if (timerRef.current) clearTimeout(timerRef.current)
    await window.api.notesWrite(active.filePath, active.body)
  }, [])

  return {
    notes: state.notes,
    activeNote: state.activeNote,
    isLoading: state.isLoading,
    history,
    selectNote,
    updateBody,
    createNote,
    deleteNote,
    refreshNotes,
    flushSave,
  }
}
