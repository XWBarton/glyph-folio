import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { EMOJI_CATEGORIES, EMOTICONS, searchEmojis, searchEmoticons } from '../lib/emojiData'

type Tab = 'emoji' | 'emoticons'

interface Props {
  x: number
  y: number
  onInsert: (text: string, type: 'emoji' | 'emoticon') => void
  onClose: () => void
}

const EMOJI_COLS = 8
const PANEL_W = 312
const PANEL_H = 380

export function EmojiPicker({ x, y, onInsert, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('emoji')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 0)
  }, [])

  useEffect(() => { setSelectedIdx(0) }, [query, tab])

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  const emojiItems = useMemo(
    () => query ? searchEmojis(query) : EMOJI_CATEGORIES.flatMap(c => c.emojis),
    [query]
  )
  const emoticonItems = useMemo(
    () => query ? searchEmoticons(query) : EMOTICONS,
    [query]
  )

  const items = tab === 'emoji' ? emojiItems : emoticonItems

  const doInsert = useCallback((text: string, type: 'emoji' | 'emoticon') => {
    onInsert(text, type); onClose()
  }, [onInsert, onClose])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault(); onClose(); break
      case 'Enter':
        e.preventDefault()
        if (items[selectedIdx]) doInsert(items[selectedIdx][0], tab)
        break
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIdx(i => Math.min(items.length - 1, i + (tab === 'emoji' ? EMOJI_COLS : 1)))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIdx(i => Math.max(0, i - (tab === 'emoji' ? EMOJI_COLS : 1)))
        break
      case 'ArrowRight':
        if (tab === 'emoji') { e.preventDefault(); setSelectedIdx(i => Math.min(items.length - 1, i + 1)) }
        break
      case 'ArrowLeft':
        if (tab === 'emoji') { e.preventDefault(); setSelectedIdx(i => Math.max(0, i - 1)) }
        break
      case 'Tab':
        e.preventDefault()
        setTab(t => t === 'emoji' ? 'emoticons' : 'emoji')
        break
    }
  }

  const adjustedX = Math.min(x, window.innerWidth - PANEL_W - 8)
  const adjustedY = y + PANEL_H > window.innerHeight ? y - PANEL_H - 28 : y

  return (
    <>
      <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
      <div
        onKeyDown={handleKeyDown}
        style={{
          position: 'fixed', left: adjustedX, top: adjustedY,
          width: PANEL_W, height: PANEL_H, zIndex: 100,
          display: 'flex', flexDirection: 'column',
          background: '#ffffff',
          border: '1px solid rgba(0,0,0,0.08)',
          borderRadius: 12,
          boxShadow: '0 8px 40px rgba(0,40,120,0.13), 0 2px 8px rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}
      >
        {/* Tabs */}
        <div style={{
          display: 'flex', borderBottom: '1px solid rgba(0,0,0,0.06)',
          padding: '6px 8px 0', gap: 4, flexShrink: 0,
        }}>
          {(['emoji', 'emoticons'] as Tab[]).map(t => (
            <button key={t} onMouseDown={e => { e.preventDefault(); setTab(t) }} style={{
              border: 'none',
              background: tab === t ? 'rgba(37,99,235,0.10)' : 'transparent',
              color: tab === t ? 'var(--accent)' : 'var(--subtext)',
              borderRadius: '6px 6px 0 0', padding: '5px 12px',
              fontSize: 12, fontWeight: tab === t ? 600 : 400,
              cursor: 'pointer', letterSpacing: '-0.01em',
              transition: 'background 0.1s, color 0.1s',
            }}>
              {t === 'emoji' ? '😀 Emoji' : '(ツ) Emoticons'}
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ padding: '8px 10px 6px', flexShrink: 0 }}>
          <input
            ref={searchRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={tab === 'emoji' ? 'Search emoji…' : 'Search emoticons…'}
            style={{
              width: '100%', border: '1px solid rgba(0,0,0,0.10)',
              borderRadius: 8, padding: '5px 10px', fontSize: 12,
              outline: 'none', background: 'rgba(0,0,0,0.03)',
              color: 'var(--text)', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px' }}>
          {tab === 'emoji' ? (
            emojiItems.length === 0 ? (
              <Empty />
            ) : query ? (
              // Flat search results
              <EmojiGrid emojis={emojiItems} selectedIdx={selectedIdx} selectedRef={selectedRef} onPick={e => doInsert(e, 'emoji')} />
            ) : (
              // Categorised browse
              EMOJI_CATEGORIES.map((cat, catIdx) => {
                const startIdx = EMOJI_CATEGORIES
                  .slice(0, catIdx)
                  .reduce((n, c) => n + c.emojis.length, 0)
                return (
                  <div key={cat.label}>
                    <div style={{
                      padding: '8px 4px 3px', fontSize: 10, fontWeight: 600,
                      letterSpacing: '0.06em', textTransform: 'uppercase',
                      color: 'var(--overlay)',
                    }}>
                      {cat.label}
                    </div>
                    <EmojiGrid
                      emojis={cat.emojis}
                      startIdx={startIdx}
                      selectedIdx={selectedIdx}
                      selectedRef={selectedRef}
                      onPick={e => doInsert(e, 'emoji')}
                    />
                  </div>
                )
              })
            )
          ) : (
            // Emoticons list
            emoticonItems.length === 0 ? (
              <Empty />
            ) : (
              emoticonItems.map(([text, name], idx) => {
                const isSelected = idx === selectedIdx
                return (
                  <button
                    key={idx}
                    ref={isSelected ? selectedRef : undefined}
                    onMouseDown={e => { e.preventDefault(); doInsert(text, 'emoticon') }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      width: '100%', border: 'none',
                      background: isSelected ? 'rgba(37,99,235,0.10)' : 'transparent',
                      borderRadius: 7, padding: '6px 8px',
                      cursor: 'pointer', margin: '1px 0',
                      transition: 'background 0.08s', textAlign: 'left',
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{
                      fontFamily: "'JetBrains Mono', Menlo, monospace",
                      fontSize: 13, color: isSelected ? 'var(--accent)' : 'var(--text)',
                      minWidth: 130, flexShrink: 0, letterSpacing: '0.02em',
                    }}>
                      {text}
                    </span>
                    <span style={{
                      fontSize: 11, color: 'var(--overlay)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {name.split(' ').slice(0, 3).join(' ')}
                    </span>
                  </button>
                )
              })
            )
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '5px 12px', borderTop: '1px solid rgba(0,0,0,0.05)',
          display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0,
        }}>
          <Hint keys={['↵']} label="insert" />
          <Hint keys={['↑', '↓']} label="navigate" />
          <Hint keys={['Tab']} label="switch" />
          <Hint keys={['Esc']} label="close" />
        </div>
      </div>
    </>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function EmojiGrid({
  emojis, startIdx = 0, selectedIdx, selectedRef, onPick
}: {
  emojis: Array<[string, string]>
  startIdx?: number
  selectedIdx: number
  selectedRef: React.RefObject<HTMLButtonElement>
  onPick: (e: string) => void
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${EMOJI_COLS}, 1fr)`, gap: 1 }}>
      {emojis.map(([emoji, name], i) => {
        const idx = startIdx + i
        const sel = idx === selectedIdx
        return (
          <button
            key={idx}
            ref={sel ? selectedRef : undefined}
            title={name}
            onMouseDown={e => { e.preventDefault(); onPick(emoji) }}
            style={{
              border: 'none', background: sel ? 'rgba(37,99,235,0.12)' : 'transparent',
              borderRadius: 6, padding: '3px 0', fontSize: 20,
              cursor: 'pointer', lineHeight: 1.3, transition: 'background 0.08s',
            }}
            onMouseEnter={e => { if (!sel) e.currentTarget.style.background = 'rgba(0,0,0,0.05)' }}
            onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'transparent' }}
          >
            {emoji}
          </button>
        )
      })}
    </div>
  )
}

function Empty() {
  return (
    <div style={{ textAlign: 'center', color: 'var(--overlay)', fontSize: 12, padding: '24px 0' }}>
      No results
    </div>
  )
}

function Hint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--overlay)' }}>
      {keys.map(k => (
        <kbd key={k} style={{
          background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.08)',
          borderRadius: 4, padding: '1px 4px', fontFamily: 'system-ui', fontSize: 10,
        }}>
          {k}
        </kbd>
      ))}
      <span style={{ marginLeft: 2 }}>{label}</span>
    </span>
  )
}
