import React, { useState } from 'react'
import type { NoteMeta, Note } from '../hooks/useNotes'
import { renderTypstTitle } from '../lib/typstTitle'

interface Props {
  notes: NoteMeta[]
  activeNote: Note | null
  activeId: string | null
  onSelect: (note: NoteMeta) => void
  onCreate: () => void
  onDelete: (filePath: string) => void
  onUpdateTags: (tags: string[]) => void
  onOpenSearch: () => void
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

export function NotesList({ notes, activeNote, activeId, onSelect, onCreate, onDelete, onUpdateTags, onOpenSearch }: Props) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; note: NoteMeta } | null>(null)
  const [addingTag, setAddingTag] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const tagInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (addingTag) tagInputRef.current?.focus()
  }, [addingTag])

  const handleAddTag = () => {
    const tag = tagInput.trim().toLowerCase().replace(/\s+/g, '-')
    if (tag && activeNote && !activeNote.tags.includes(tag)) {
      onUpdateTags([...activeNote.tags, tag])
    }
    setTagInput('')
    setAddingTag(false)
  }

  const handleRemoveTag = (tag: string) => {
    if (!activeNote) return
    onUpdateTags(activeNote.tags.filter(t => t !== tag))
  }

  return (
    <div className="notes-list-panel" onClick={() => setContextMenu(null)}>
      {/* Header */}
      <div className="notes-list-header">
        <span style={{
          fontSize: 12, fontWeight: 600, color: 'var(--subtext)',
          letterSpacing: '-0.01em', userSelect: 'none',
        }}>
          Notes
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={onOpenSearch}
            title="Search & explore (⌘K)"
            style={{
              background: 'rgba(0,0,0,0.04)',
              border: '1px solid rgba(0,0,0,0.08)',
              borderRadius: 6, width: 22, height: 22,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'var(--subtext)',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.8"/>
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
          <button
            onClick={onCreate}
            title="New Note (⌘N)"
            style={{
              background: 'rgba(37,99,235,0.12)',
              border: '1px solid rgba(37,99,235,0.2)',
              borderRadius: 6, width: 22, height: 22,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 15, color: 'var(--accent)', lineHeight: 1,
            }}
          >+</button>
        </div>
      </div>

      {/* Note list */}
      <div className="notes-list-scroll">
        {notes.length === 0 && (
          <div style={{
            padding: '24px 16px', textAlign: 'center',
            color: 'var(--overlay)', fontSize: 12,
          }}>
            No notes yet. Press + to create one.
          </div>
        )}

        {notes.map(note => {
          const isActive = activeId === note.id
          const displayTags = isActive && activeNote ? activeNote.tags : note.tags
          return (
            <div
              key={note.id}
              className={`note-row${isActive ? ' active' : ''}`}
              onClick={() => onSelect(note)}
              onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, note }) }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div className="note-row-title">{renderTypstTitle(note.title)}</div>
                <div className="note-row-date">{relativeTime(note.modifiedAt)}</div>
              </div>

              {/* Tags */}
              {(displayTags.length > 0 || isActive) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4, alignItems: 'center' }}>
                  {displayTags.map(tag => {
                    const c = tagColor(tag)
                    return (
                      <span
                        key={tag}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 2,
                          background: c.bg, color: c.text, border: `1px solid ${c.border}`,
                          borderRadius: 4, padding: '1px 5px', fontSize: 10, fontWeight: 500,
                        }}
                      >
                        {tag}
                        {isActive && (
                          <button
                            onClick={e => { e.stopPropagation(); handleRemoveTag(tag) }}
                            style={{
                              background: 'none', border: 'none', padding: 0,
                              cursor: 'pointer', color: c.text, opacity: 0.6,
                              fontSize: 10, lineHeight: 1, display: 'flex', alignItems: 'center',
                            }}
                          >×</button>
                        )}
                      </span>
                    )
                  })}
                  {isActive && !addingTag && (
                    <button
                      onClick={e => { e.stopPropagation(); setAddingTag(true) }}
                      style={{
                        background: 'rgba(0,0,0,0.04)', border: '1px dashed rgba(0,0,0,0.15)',
                        borderRadius: 4, padding: '1px 5px', fontSize: 10,
                        color: 'var(--subtext)', cursor: 'pointer',
                      }}
                    >+ tag</button>
                  )}
                  {isActive && addingTag && (
                    <input
                      ref={tagInputRef}
                      value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); handleAddTag() }
                        if (e.key === 'Escape') { setAddingTag(false); setTagInput('') }
                      }}
                      onBlur={handleAddTag}
                      onClick={e => e.stopPropagation()}
                      placeholder="tag name"
                      style={{
                        width: 64, fontSize: 10, padding: '1px 5px',
                        border: '1px solid rgba(37,99,235,0.3)', borderRadius: 4,
                        background: 'rgba(37,99,235,0.05)', color: 'var(--text)', outline: 'none',
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setContextMenu(null)} />
          <div style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 100,
            background: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            border: '1px solid rgba(255,255,255,0.85)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 8px 32px rgba(0,40,120,0.10)',
            padding: 4, minWidth: 140,
          }}>
            <button
              onClick={() => { onDelete(contextMenu.note.filePath); setContextMenu(null) }}
              style={{
                width: '100%', background: 'transparent', border: 'none',
                borderRadius: 7, padding: '7px 10px', textAlign: 'left',
                fontSize: 12, color: 'var(--red)', cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(220,38,38,0.08)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              Delete Note
            </button>
          </div>
        </>
      )}
    </div>
  )
}
