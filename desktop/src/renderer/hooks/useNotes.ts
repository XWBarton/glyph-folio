import { useState, useCallback, useEffect, useRef } from 'react'

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
      await window.api.notesWrite(active.filePath, active.body)
      // Refresh list so modifiedAt updates
      const notes = await window.api.notesList()
      setState(s => ({ ...s, notes }))
    }, AUTO_SAVE_DELAY)
  }, [])

  // ── Select / load a note ────────────────────────────────────────────────────

  const selectNote = useCallback(async (meta: NoteMeta) => {
    // Flush pending save for current note before switching
    if (dirtyRef.current) {
      const active = stateRef.current.activeNote
      if (active) {
        dirtyRef.current = false
        if (timerRef.current) clearTimeout(timerRef.current)
        await window.api.notesWrite(active.filePath, active.body)
      }
    }
    const note = await window.api.notesRead(meta.filePath)
    if (note) setState(s => ({ ...s, activeNote: note }))
  }, [])

  // ── Update body (called on every editor change) ─────────────────────────────

  const updateBody = useCallback((body: string) => {
    dirtyRef.current = true
    setState(s => ({
      ...s,
      activeNote: s.activeNote ? { ...s.activeNote, body } : null
    }))
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
    selectNote,
    updateBody,
    createNote,
    deleteNote,
    refreshNotes,
    flushSave,
  }
}
