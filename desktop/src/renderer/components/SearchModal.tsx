import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import type { NoteMeta } from '../hooks/useNotes'
import { GraphView } from './GraphView'

interface SearchResult extends NoteMeta {
  excerpt: string
  matchedIn: 'title' | 'tags' | 'body'
}

interface Props {
  open: boolean
  notes: NoteMeta[]
  activeNoteId: string | null
  onClose: () => void
  onSelect: (note: NoteMeta) => void
  onCreate: () => Promise<NoteMeta>
  onDelete: (filePath: string) => void
}

const TAG_COLORS = [
  { bg: 'rgba(37,99,235,0.10)',  text: 'rgba(37,99,235,0.85)',  border: 'rgba(37,99,235,0.18)' },
  { bg: 'rgba(5,150,105,0.10)',  text: 'rgba(5,150,105,0.85)',  border: 'rgba(5,150,105,0.18)' },
  { bg: 'rgba(124,58,237,0.10)', text: 'rgba(124,58,237,0.85)', border: 'rgba(124,58,237,0.18)' },
  { bg: 'rgba(234,88,12,0.10)',  text: 'rgba(234,88,12,0.85)',  border: 'rgba(234,88,12,0.18)' },
  { bg: 'rgba(219,39,119,0.10)', text: 'rgba(219,39,119,0.85)', border: 'rgba(219,39,119,0.18)' },
  { bg: 'rgba(8,145,178,0.10)',  text: 'rgba(8,145,178,0.85)',  border: 'rgba(8,145,178,0.18)' },
]

function tagColor(tag: string) {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0
  return TAG_COLORS[hash % TAG_COLORS.length]
}

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60)    return 'just now'
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function SearchModal({ open, notes, activeNoteId, onClose, onSelect, onCreate, onDelete }: Props) {
  const [view, setView] = useState<'list' | 'graph'>('list')
  const [graphLens, setGraphLens] = useState<'links' | 'tags'>('links')
  const [query, setQuery] = useState('')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [focusedIdx, setFocusedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // All unique tags across notes
  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const n of notes) n.tags.forEach(t => set.add(t))
    return Array.from(set).sort()
  }, [notes])

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveTags([])
      setSearchResults(null)
      setFocusedIdx(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // Deep search debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (!q) {
      setSearchResults(null)
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    debounceRef.current = setTimeout(async () => {
      const results = await window.api.notesSearch(q)
      setSearchResults(results as SearchResult[])
      setIsSearching(false)
      setFocusedIdx(0)
    }, 200)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  // Displayed results: search results OR all notes, filtered by active tags
  const displayed = useMemo<Array<NoteMeta | SearchResult>>(() => {
    const base: Array<NoteMeta | SearchResult> = searchResults ?? notes
    if (activeTags.length === 0) return base
    return base.filter(n => activeTags.every(t => n.tags.includes(t)))
  }, [searchResults, notes, activeTags])

  const handleCreate = useCallback(async () => {
    const note = await onCreate()
    onClose()
    // note is already selected via createNote in App
    void note
  }, [onCreate, onClose])

  const handleDelete = useCallback((note: NoteMeta, e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete(note.filePath)
  }, [onDelete])

  // Reset focused index when results change
  useEffect(() => { setFocusedIdx(0) }, [displayed])

  // Scroll focused item into view
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelectorAll<HTMLElement>('[data-result-row]')[focusedIdx]
    el?.scrollIntoView({ block: 'nearest' })
  }, [focusedIdx])

  const handleSelect = useCallback((note: NoteMeta) => {
    onSelect(note)
    onClose()
  }, [onSelect, onClose])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIdx(i => Math.min(i + 1, displayed.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && displayed[focusedIdx]) {
      handleSelect(displayed[focusedIdx])
    }
  }

  const toggleTag = (tag: string) => {
    setActiveTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    )
    setFocusedIdx(0)
    inputRef.current?.focus()
  }

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15, 20, 40, 0.35)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '10vh',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        onKeyDown={handleKeyDown}
        style={{
          width: view === 'graph' ? 780 : 640,
          maxWidth: 'calc(100vw - 48px)',
          background: 'rgba(250,251,255,0.92)',
          backdropFilter: 'blur(32px) saturate(200%)',
          WebkitBackdropFilter: 'blur(32px) saturate(200%)',
          border: '1px solid rgba(255,255,255,0.9)',
          borderRadius: 14,
          boxShadow: '0 24px 64px rgba(0,20,100,0.18), 0 2px 8px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.95)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          height: view === 'graph' ? '72vh' : undefined,
          maxHeight: '72vh',
          transition: 'width 0.2s',
        }}
      >
        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 18px',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
          flexShrink: 0,
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.4 }}>
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search notes…"
            spellCheck={false}
            style={{
              flex: 1, border: 'none', outline: 'none',
              background: 'transparent',
              fontSize: 16, color: 'var(--text)',
              fontFamily: 'inherit',
            }}
          />
          {isSearching && (
            <div style={{
              width: 12, height: 12, borderRadius: '50%',
              border: '1.5px solid rgba(37,99,235,0.15)',
              borderTopColor: 'var(--accent)',
              animation: 'spin 0.7s linear infinite',
              flexShrink: 0,
            }} />
          )}
          {/* View toggle */}
          <div style={{
            display: 'flex', background: 'rgba(0,0,0,0.05)',
            borderRadius: 7, padding: 2, gap: 1, flexShrink: 0,
          }}>
            {(['list', 'graph'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                background: view === v ? 'rgba(255,255,255,0.9)' : 'transparent',
                border: 'none', borderRadius: 5, padding: '3px 10px',
                fontSize: 11, color: view === v ? 'var(--text)' : 'var(--overlay)',
                cursor: 'pointer', fontFamily: 'inherit',
                boxShadow: view === v ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.1s', letterSpacing: '-0.01em',
                fontWeight: view === v ? 500 : 400,
              }}>{v === 'list' ? 'List' : 'Graph'}</button>
            ))}
          </div>

          <button
            onClick={handleCreate}
            title="New note (⌘N)"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(37,99,235,0.10)',
              border: '1px solid rgba(37,99,235,0.2)',
              borderRadius: 7, padding: '5px 10px',
              fontSize: 12, color: 'var(--accent)',
              cursor: 'pointer', fontFamily: 'inherit',
              letterSpacing: '-0.01em', flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> New
          </button>
        </div>

        {/* Graph view */}
        {view === 'graph' && (
          <>
            {/* Lens toggle */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 18px',
              borderBottom: '1px solid rgba(0,0,0,0.06)',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 11, color: 'var(--overlay)', letterSpacing: '-0.01em' }}>Lens:</span>
              {(['links', 'tags'] as const).map(l => (
                <button key={l} onClick={() => setGraphLens(l)} style={{
                  background: graphLens === l ? 'rgba(37,99,235,0.10)' : 'transparent',
                  border: `1px solid ${graphLens === l ? 'rgba(37,99,235,0.2)' : 'rgba(0,0,0,0.08)'}`,
                  borderRadius: 6, padding: '3px 10px',
                  fontSize: 11, color: graphLens === l ? 'var(--accent)' : 'var(--subtext)',
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontWeight: graphLens === l ? 500 : 400,
                  letterSpacing: '-0.01em',
                }}>{l === 'links' ? 'Links' : 'Tags'}</button>
              ))}
              <span style={{ fontSize: 10, color: 'var(--overlay)', marginLeft: 'auto' }}>
                Click node to open · ⌘+click in editor to navigate
              </span>
            </div>
            <GraphView
              notes={notes}
              lens={graphLens}
              activeNoteId={activeNoteId}
              onSelect={id => {
                const note = notes.find(n => n.id === id)
                if (note) handleSelect(note)
              }}
            />
          </>
        )}

        {/* Tag filters */}
        {view === 'list' && allTags.length > 0 && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 6,
            padding: '10px 18px',
            borderBottom: '1px solid rgba(0,0,0,0.06)',
            flexShrink: 0,
          }}>
            {allTags.map(tag => {
              const c = tagColor(tag)
              const isActive = activeTags.includes(tag)
              const count = notes.filter(n => n.tags.includes(tag)).length
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: isActive ? c.bg : 'rgba(0,0,0,0.04)',
                    color: isActive ? c.text : 'var(--subtext)',
                    border: `1px solid ${isActive ? c.border : 'rgba(0,0,0,0.08)'}`,
                    borderRadius: 6, padding: '4px 9px',
                    fontSize: 12, fontWeight: isActive ? 600 : 400,
                    cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'all 0.12s',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {tag}
                  <span style={{
                    fontSize: 10, opacity: 0.6,
                    background: isActive ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.06)',
                    borderRadius: 3, padding: '0 4px',
                  }}>{count}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Results (list mode only) */}
        {view === 'list' && <div ref={listRef} style={{ flex: 1, overflowY: 'auto' }}>
          {/* Status line */}
          <div style={{
            padding: '8px 18px 4px',
            fontSize: 11, color: 'var(--overlay)',
            letterSpacing: '-0.01em',
          }}>
            {displayed.length === 0
              ? 'No notes match'
              : `${displayed.length} note${displayed.length !== 1 ? 's' : ''}${query.trim() ? '' : ''}`}
          </div>

          {displayed.map((note, idx) => {
            const result = note as SearchResult
            const isFocused = idx === focusedIdx
            return (
              <div
                key={note.id}
                data-result-row
                onClick={() => handleSelect(note)}
                onMouseMove={() => setFocusedIdx(idx)}
                style={{
                  padding: '10px 18px',
                  cursor: 'pointer',
                  borderBottom: '1px solid rgba(0,0,0,0.04)',
                  background: isFocused ? 'rgba(37,99,235,0.07)' : 'transparent',
                  borderLeft: `3px solid ${isFocused ? 'var(--accent)' : 'transparent'}`,
                  transition: 'background 0.08s',
                  position: 'relative',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div style={{
                    fontSize: 13.5, fontWeight: 500, color: 'var(--text)',
                    letterSpacing: '-0.01em',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    flex: 1,
                  }}>
                    {note.title}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: 'var(--overlay)' }}>
                      {relativeTime(note.modifiedAt)}
                    </span>
                    {isFocused && (
                      <button
                        onClick={e => handleDelete(note, e)}
                        style={{
                          background: 'transparent', border: 'none', padding: '1px 4px',
                          borderRadius: 4, cursor: 'pointer',
                          fontSize: 11, color: 'var(--overlay)',
                          transition: 'color 0.1s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)' }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--overlay)' }}
                        title="Delete note"
                      >Delete</button>
                    )}
                  </div>
                </div>

                {note.tags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
                    {note.tags.map(tag => {
                      const c = tagColor(tag)
                      const isFilterActive = activeTags.includes(tag)
                      return (
                        <span
                          key={tag}
                          style={{
                            background: c.bg, color: c.text,
                            border: `1px solid ${isFilterActive ? c.text : c.border}`,
                            borderRadius: 4, padding: '1px 6px',
                            fontSize: 10.5, fontWeight: isFilterActive ? 600 : 400,
                            letterSpacing: '-0.01em',
                          }}
                        >{tag}</span>
                      )
                    })}
                  </div>
                )}

                {result.excerpt && (
                  <div style={{
                    marginTop: 5, fontSize: 11.5,
                    color: 'var(--subtext)', lineHeight: 1.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                    {result.excerpt}
                  </div>
                )}
              </div>
            )
          })}

          {/* Bottom padding */}
          <div style={{ height: 8 }} />
        </div>}

        {/* Footer hint */}
        <div style={{
          padding: '8px 18px',
          borderTop: '1px solid rgba(0,0,0,0.06)',
          display: 'flex', gap: 14, alignItems: 'center',
          flexShrink: 0,
        }}>
          {[
            ['↑↓', 'navigate'],
            ['↵', 'open'],
            ['esc', 'close'],
          ].map(([key, label]) => (
            <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--overlay)' }}>
              <kbd style={{
                background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.10)',
                borderRadius: 3, padding: '1px 5px', fontFamily: 'inherit', fontSize: 10,
              }}>{key}</kbd>
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
