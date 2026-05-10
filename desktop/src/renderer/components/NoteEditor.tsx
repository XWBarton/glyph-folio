import React, { useEffect, useRef, useState, useCallback } from 'react'
import MonacoEditor, { loader, type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import type { editor } from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { registerTypstLanguage, TYPST_LANGUAGE_ID } from '../lib/typstLanguage'
import { buildMonacoTheme, type TokenColors } from '../lib/tokenColors'
import { filterCommands, type SlashCommand } from '../lib/slashCommands'
import { SlashCommandPalette } from './SlashCommandPalette'
import { WikiLinkPalette } from './WikiLinkPalette'
import { TagPalette } from './TagPalette'
import { FindReplaceModal } from './FindReplaceModal'
import { SpellSuggestions } from './SpellSuggestions'
import { EmojiPicker } from './EmojiPicker'
import { useSpellCheck } from '../hooks/useSpellCheck'
import type { NoteMeta } from '../hooks/useNotes'

self.MonacoEnvironment = { getWorker: () => new editorWorker() }
loader.config({ monaco })

registerTypstLanguage(monaco)
monaco.editor.defineTheme('glyph-light', buildMonacoTheme({}, false))
monaco.editor.defineTheme('glyph-dark',  buildMonacoTheme({}, true))

// Inject suggest widget overrides once
if (!document.getElementById('glyph-folio-suggest-overrides')) {
  const style = document.createElement('style')
  style.id = 'glyph-folio-suggest-overrides'
  style.textContent = `
    .suggest-widget {
      border-radius: 10px !important;
      backdrop-filter: blur(28px) saturate(200%) !important;
      -webkit-backdrop-filter: blur(28px) saturate(200%) !important;
      box-shadow: 0 8px 32px rgba(0,40,120,0.13), 0 2px 8px rgba(0,0,0,0.07),
                  inset 0 1px 0 rgba(255,255,255,0.9) !important;
      overflow: hidden !important;
      max-width: 320px !important;
    }
    .suggest-widget .details, .suggest-widget > .details, .suggest-widget-details,
    .suggest-widget .suggest-status-bar { display: none !important; }
    .suggest-widget .monaco-list-row { border-radius: 6px !important; margin: 1px 4px !important; }
  `
  document.head.appendChild(style)
}

interface PaletteState {
  open: boolean; x: number; y: number
  commands: SlashCommand[]; selectedIndex: number
}

interface WikiPaletteState {
  open: boolean; x: number; y: number
  notes: NoteMeta[]; selectedIndex: number
}

interface TagPaletteState {
  open: boolean; x: number; y: number
  tags: string[]; selectedIndex: number
}

interface Props {
  value: string
  onChange: (value: string) => void
  tokenColors: TokenColors
  fontSize: number
  spellCheckEnabled: boolean
  onToggleSpellIgnore?: () => void
  customDictionary: string[]
  onAddToDict: (word: string) => void
  notes: NoteMeta[]
  onNavigate: (title: string) => void
  noteId: string
  onPickImage: () => Promise<string | null>
  onDropImage: (srcPath: string) => Promise<string | null>
  onPasteImage: (bytes: Uint8Array, ext: string) => Promise<string | null>
  focusTitleKey?: number
}

export function NoteEditor({
  value, onChange, tokenColors, fontSize, spellCheckEnabled, onToggleSpellIgnore,
  customDictionary, onAddToDict, notes, onNavigate, noteId, onPickImage, onDropImage, onPasteImage, focusTitleKey
}: Props) {
  const [isDark, setIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    monaco.editor.defineTheme('glyph-light', buildMonacoTheme(tokenColors, false))
    monaco.editor.defineTheme('glyph-dark',  buildMonacoTheme(tokenColors, true))
    monaco.editor.setTheme(isDark ? 'glyph-dark' : 'glyph-light')
  }, [tokenColors, isDark])

  const [findOpen, setFindOpen] = useState(false)
  const [findShowReplace, setFindShowReplace] = useState(false)
  const [findQuery, setFindQuery] = useState('')

  const openFindRef = useRef<(showReplace: boolean) => void>(() => {})
  openFindRef.current = (showReplace: boolean) => {
    const ed = editorRef.current
    const selection = ed?.getSelection()
    const model = ed?.getModel()
    const selected = (selection && model) ? model.getValueInRange(selection).trim() : ''
    if (selected) setFindQuery(selected)
    setFindShowReplace(showReplace)
    setFindOpen(true)
  }

  const [palette, setPalette] = useState<PaletteState>({
    open: false, x: 0, y: 0, commands: [], selectedIndex: 0
  })
  const paletteRef    = useRef(palette)
  paletteRef.current  = palette

  const [wikiPalette, setWikiPalette] = useState<WikiPaletteState>({
    open: false, x: 0, y: 0, notes: [], selectedIndex: 0
  })
  const wikiPaletteRef   = useRef(wikiPalette)
  wikiPaletteRef.current = wikiPalette
  const wikiPosRef       = useRef<{ lineNumber: number; column: number } | null>(null)

  const [tagPalette, setTagPalette] = useState<TagPaletteState>({ open: false, x: 0, y: 0, tags: [], selectedIndex: 0 })
  const tagPaletteRef   = useRef(tagPalette)
  tagPaletteRef.current = tagPalette
  const tagPosRef       = useRef<{ lineNumber: number; column: number } | null>(null)

  const [bookmarkOpen, setBookmarkOpen] = useState(false)
  const [bookmarkUrl, setBookmarkUrl] = useState('')
  const bookmarkSlashRef = useRef<{ sl: number; sc: number; el: number; ec: number } | null>(null)

  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [emojiPickerPos, setEmojiPickerPos] = useState({ x: 0, y: 0 })
  const emojiSlashRef = useRef<{ sl: number; sc: number; el: number; ec: number } | null>(null)

  const [reminderOpen, setReminderOpen] = useState(false)
  const [reminderQuickMode, setReminderQuickMode] = useState(true)
  const [reminderDate, setReminderDate] = useState('')
  const [reminderToast, setReminderToast] = useState<string | null>(null)
  const reminderSlashRef = useRef<{ sl: number; sc: number; el: number; ec: number } | null>(null)

  const editorRef    = useRef<editor.IStandaloneCodeEditor | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const slashPosRef  = useRef<{ lineNumber: number; column: number } | null>(null)
  const notesRef     = useRef(notes)
  notesRef.current   = notes
  const onNavigateRef = useRef(onNavigate)
  onNavigateRef.current = onNavigate
  const noteIdRef = useRef(noteId)
  noteIdRef.current = noteId
  const onPickImageRef = useRef(onPickImage)
  onPickImageRef.current = onPickImage
  const onDropImageRef = useRef(onDropImage)
  onDropImageRef.current = onDropImage
  const onPasteImageRef = useRef(onPasteImage)
  onPasteImageRef.current = onPasteImage

  const [spellToast, setSpellToast] = useState<'enabled' | 'disabled' | null>(null)
  const spellEnabledRef = useRef(spellCheckEnabled)
  spellEnabledRef.current = spellCheckEnabled
  const onToggleSpellRef = useRef(onToggleSpellIgnore)
  onToggleSpellRef.current = onToggleSpellIgnore

  const { popup: spellPopup, closePopup: closeSpellPopup, handleMouseDown: spellMouseDown, replaceWord } =
    useSpellCheck(editorRef, value, customDictionary, spellCheckEnabled)
  const spellMouseDownRef = useRef(spellMouseDown)
  spellMouseDownRef.current = spellMouseDown

  const insertImageSnippet = useCallback((filename: string) => {
    const ed = editorRef.current; if (!ed) return
    const pos = ed.getPosition(); if (!pos) return
    const nid = noteIdRef.current
    const snippet = `#figure(\n  image("attachments/${nid}/${filename}", width: \${1:80%}),\n  caption: [\${2}],\n)\n`
    const ctrl = ed.getContribution('snippetController2') as { insert?: (s: string) => void }
    if (ctrl?.insert) ctrl.insert(snippet)
    else ed.executeEdits('image-insert', [{ range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: snippet.replace(/\$\{[0-9]+\}/g, '').replace(/\$[0-9]+/g, '') }])
    ed.focus()
  }, [])

  // Format a Date as a local ISO string without timezone: "2026-04-22T10:00:00"
  const toLocalISOString = (d: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
  }

  // Format a Date for <input type="datetime-local">: "2026-04-22T10:00"
  const toLocalInputValue = (d: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  // Extract note title from body (mirrors iOS Note.extractTitle logic)
  const extractNoteTitle = (body: string, id: string): string => {
    const override = body.match(/^\/\/\s*=\s+(.+)$/m)
    if (override) return override[1].trim()
    const heading = body.match(/^={1,6}\s+(.+)$/m)
    if (heading) return heading[1].trim()
    const clean = id.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' ')
    return clean.charAt(0).toUpperCase() + clean.slice(1) || 'Untitled'
  }

  const confirmReminder = useCallback((date: Date) => {
    // Snapshot refs before any state changes
    const savedSlash = reminderSlashRef.current
    reminderSlashRef.current = null
    setReminderOpen(false)

    // Defer edits until after React has finished closing the modal overlay —
    // same pattern used by /image, /tag, /checklist etc.
    setTimeout(() => {
      const ed = editorRef.current
      if (!ed) return

      // Delete the /remind trigger text
      if (savedSlash) {
        const { sl, sc, el, ec } = savedSlash
        ed.executeEdits('slash-remind', [{ range: new monaco.Range(sl, sc, el, ec), text: '' }])
      }

      const model = ed.getModel()
      if (!model) { ed.focus(); return }

      const isoDate = toLocalISOString(date)
      const reminderLine = `// @reminder: ${isoDate}`
      const lines = model.getValue().split('\n')

      // Replace existing // @reminder: line, or insert after // @tags:
      const existingIdx = lines.findIndex(l => /^\/\/ @reminder:/.test(l))
      if (existingIdx !== -1) {
        ed.executeEdits('slash-remind', [{
          range: new monaco.Range(existingIdx + 1, 1, existingIdx + 1, lines[existingIdx].length + 1),
          text: reminderLine
        }])
      } else {
        const tagsIdx = lines.findIndex(l => /^\/\/ @tags:/.test(l))
        const insertAfterLine = tagsIdx !== -1 ? tagsIdx + 1 : 0
        ed.executeEdits('slash-remind', [{
          range: new monaco.Range(insertAfterLine + 1, 1, insertAfterLine + 1, 1),
          text: reminderLine + '\n'
        }])
      }

      // Schedule the reminder in the main process
      const noteTitle = extractNoteTitle(model.getValue(), noteIdRef.current)
      window.api.reminderSet(noteIdRef.current, noteTitle, isoDate)
        .then(() => {
          const label = date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          setReminderToast(`Reminder set for ${label}`)
          setTimeout(() => setReminderToast(null), 3000)
        })
        .catch(err => console.error('[GlyphFolio Reminder] Failed to schedule:', err))

      ed.focus()
    }, 0)
  }, [])

  const doInsert = useCallback((cmd: SlashCommand) => {
    const ed = editorRef.current; const slash = slashPosRef.current
    if (!ed || !slash) return
    const pos = ed.getPosition(); if (!pos) return
    slashPosRef.current = null
    setPalette(p => ({ ...p, open: false }))
    const { lineNumber: sl, column: sc } = slash
    const { lineNumber: el, column: ec } = pos

    if (cmd.id === 'image') {
      // Delete the slash trigger text, then open file picker
      setTimeout(() => {
        ed.setSelection(new monaco.Selection(sl, sc, el, ec))
        ed.executeEdits('slash-image', [{ range: ed.getSelection()!, text: '' }])
        onPickImageRef.current().then(filename => {
          if (filename) insertImageSnippet(filename)
        })
      }, 0)
      return
    }

    if (cmd.id === 'datetime') {
      setTimeout(() => {
        ed.setSelection(new monaco.Selection(sl, sc, el, ec))
        const now = new Date()
        const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
        ed.executeEdits('datetime-insert', [{ range: ed.getSelection()!, text: `${dateStr} · ${timeStr}` }])
        ed.focus()
      }, 0)
      return
    }

    if (cmd.id === 'tag') {
      // Delete the /tag text, then jump to (or create) the // @tags: line
      setTimeout(() => {
        ed.setSelection(new monaco.Selection(sl, sc, el, ec))
        ed.executeEdits('slash-tag', [{ range: ed.getSelection()!, text: '' }])
        const model = ed.getModel()
        if (!model) { ed.focus(); return }
        const lines = model.getValue().split('\n')
        const tagLineIdx = lines.findIndex(l => /^\/\/ @tags:/.test(l))
        if (tagLineIdx !== -1) {
          const lineNumber = tagLineIdx + 1
          const column = lines[tagLineIdx].length + 1
          ed.setPosition({ lineNumber, column })
          ed.revealLine(lineNumber)
        } else {
          // Insert // @tags:  at line 1
          const insertRange = new monaco.Range(1, 1, 1, 1)
          ed.executeEdits('slash-tag', [{ range: insertRange, text: '// @tags: \n' }])
          ed.setPosition({ lineNumber: 1, column: 11 }) // after "// @tags: "
          ed.revealLine(1)
        }
        ed.focus()
      }, 0)
      return
    }

    if (cmd.id === 'bookmark') {
      bookmarkSlashRef.current = { sl, sc, el, ec }
      setBookmarkUrl('')
      setBookmarkOpen(true)
      return
    }

    if (cmd.id === 'emoji') {
      emojiSlashRef.current = { sl, sc, el, ec }
      const pixelPos = ed.getScrolledVisiblePosition({ lineNumber: sl, column: sc })
      const rect = ed.getDomNode()?.getBoundingClientRect()
      if (pixelPos && rect) {
        setEmojiPickerPos({ x: rect.left + pixelPos.left, y: rect.top + pixelPos.top + 22 })
      }
      setEmojiPickerOpen(true)
      setTimeout(() => ed.blur(), 0)
      return
    }

    if (cmd.id === 'remind') {
      reminderSlashRef.current = { sl, sc, el, ec }
      const now = new Date()
      now.setDate(now.getDate() + 1)
      now.setSeconds(0)
      setReminderDate(toLocalInputValue(now))
      setReminderQuickMode(true)
      setReminderOpen(true)
      setTimeout(() => ed.blur(), 0)
      return
    }

    if (cmd.id === 'checklist') {
      // Delete the /checklist trigger, inject import below // @tags: if needed, insert item at cursor
      setTimeout(() => {
        const model = ed.getModel()
        if (!model) return
        // Delete the trigger
        ed.setSelection(new monaco.Selection(sl, sc, el, ec))
        ed.executeEdits('slash-checklist', [{ range: ed.getSelection()!, text: '' }])

        const edits: { range: monaco.Range; text: string }[] = []

        // Inject import+show block below // @tags: if not already present
        const content = model.getValue()
        if (!content.includes('@preview/cheq')) {
          const lines = content.split('\n')
          const tagLineIdx = lines.findIndex(l => /^\/\/ @tags:/.test(l))
          const insertAfterLine = tagLineIdx !== -1 ? tagLineIdx + 1 : 0
          const importText = '#import "@preview/cheq:0.3.0": checklist\n#show: checklist\n'
          edits.push({ range: new monaco.Range(insertAfterLine + 1, 1, insertAfterLine + 1, 1), text: importText })
        }

        if (edits.length > 0) ed.executeEdits('slash-checklist', edits)

        // Insert a single checkbox item at cursor
        const newPos = ed.getPosition()!
        const ctrl = ed.getContribution('snippetController2') as any
        if (ctrl?.insert) ctrl.insert('- [ ] ${1:item}')
        else ed.executeEdits('slash-checklist', [{ range: new monaco.Range(newPos.lineNumber, newPos.column, newPos.lineNumber, newPos.column), text: '- [ ] item' }])
        ed.focus()
      }, 0)
      return
    }

    setTimeout(() => {
      ed.setSelection(new monaco.Selection(sl, sc, el, ec))
      ed.focus()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctrl = ed.getContribution('snippetController2') as any
      if (ctrl?.insert) ctrl.insert(cmd.snippet)
      else ed.trigger('slash', 'editor.action.insertSnippet', { snippet: cmd.snippet })
    }, 0)
  }, [])

  const closePalette = useCallback(() => {
    slashPosRef.current = null
    setPalette(p => ({ ...p, open: false }))
  }, [])

  const closeWikiPalette = useCallback(() => {
    wikiPosRef.current = null
    setWikiPalette(p => ({ ...p, open: false }))
  }, [])

  const closeTagPalette = useCallback(() => {
    tagPosRef.current = null
    setTagPalette(p => ({ ...p, open: false }))
  }, [])

  const insertTag = useCallback((tag: string) => {
    const ed = editorRef.current; const pos = tagPosRef.current
    if (!ed || !pos) return
    const cur = ed.getPosition(); if (!cur) return
    tagPosRef.current = null
    setTagPalette(p => ({ ...p, open: false }))
    ed.executeEdits('tag-insert', [{
      range: new monaco.Range(pos.lineNumber, pos.column, cur.lineNumber, cur.column),
      text: tag
    }])
    ed.setPosition({ lineNumber: pos.lineNumber, column: pos.column + tag.length })
    ed.focus()
  }, [])

  const submitBookmark = useCallback(async (rawUrl: string) => {
    setBookmarkOpen(false)
    const ed = editorRef.current; const slash = bookmarkSlashRef.current
    if (!ed || !rawUrl.trim()) { ed?.focus(); return }
    const { sl, sc, el, ec } = slash!
    bookmarkSlashRef.current = null

    // Delete the slash trigger text
    ed.executeEdits('slash-bookmark', [{ range: new monaco.Range(sl, sc, el, ec), text: '' }])

    const fullUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
    let domain = fullUrl, title = '', description = '', imagePath = ''
    try { domain = new URL(fullUrl).hostname.replace(/^www\./, '') } catch {}
    title = domain  // default: domain (raw URL would trigger // Typst line comment)

    try {
      const html = await fetch(fullUrl).then(r => r.text())
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
      const ogDesc  = doc.querySelector('meta[property="og:description"]')?.getAttribute('content')
      const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute('content')
      const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute('content')
      title = (ogTitle || doc.title || domain).trim()
      description = (ogDesc || metaDesc || '').trim()

      if (ogImage) {
        try {
          const imgResp = await fetch(ogImage)
          const imgBuf = await imgResp.arrayBuffer()
          const ct = imgResp.headers.get('content-type') ?? ''
          const ext = ct.includes('png') ? 'png' : ct.includes('gif') ? 'gif' : ct.includes('webp') ? 'webp' : 'jpg'
          const filename = `bm-${crypto.randomUUID()}.${ext}`
          // btoa in chunks to avoid stack overflow on large buffers
          const bytes = new Uint8Array(imgBuf)
          let b64 = ''; const chunk = 8192
          for (let i = 0; i < bytes.length; i += chunk)
            b64 += String.fromCharCode(...bytes.subarray(i, i + chunk))
          b64 = btoa(b64)
          const noteId = noteIdRef.current
          const res = await window.api.attachmentsWrite(noteId, filename, b64)
          if ('ok' in res && res.ok) imagePath = `attachments/${noteId}/${filename}`
        } catch { /* image unavailable — proceed without */ }
      }
    } catch { /* page fetch failed */ }

    // Escape text for Typst content mode: [], #, *, _, and // (line comment trigger)
    const esc = (s: string) => s
      .replace(/\[/g, '\\[').replace(/\]/g, '\\]')
      .replace(/#/g, '\\#').replace(/\*/g, '\\*').replace(/_/g, '\\_')
      .replace(/\/\//g, '/\u200B/')

    // Build text column: title → description → domain (Notion-style stacking)
    const textLines: string[] = [`#link("${fullUrl}")[*${esc(title)}*]`]
    if (description) textLines.push(`#text(size: 9pt, fill: luma(110))[${esc(description)}]`)
    textLines.push(`#text(size: 8pt, fill: luma(160))[${esc(domain)}]`)
    const textCol = textLines.join('\\\n    ')

    let snippet: string
    if (imagePath) {
      snippet = [
        `#block(stroke: 0.5pt + luma(215), radius: 6pt, inset: 10pt, width: 100%)[`,
        `  #grid(columns: (1fr, 88pt), gutter: 10pt, align: (left + top, right + top),`,
        `    [${textCol}],`,
        `    [#box(radius: 4pt, clip: true)[#image("${imagePath}", width: 88pt, height: 66pt, fit: "cover")]],`,
        `  )`,
        `]`,
      ].join('\n') + '\n'
    } else {
      snippet = [
        `#block(stroke: 0.5pt + luma(215), radius: 6pt, inset: (x: 12pt, y: 10pt), width: 100%)[`,
        `  ${textCol}`,
        `]`,
      ].join('\n') + '\n'
    }

    const insertPos = ed.getPosition() ?? { lineNumber: sl, column: sc }
    ed.executeEdits('bookmark-insert', [{
      range: new monaco.Range(insertPos.lineNumber, insertPos.column, insertPos.lineNumber, insertPos.column),
      text: snippet
    }])
    ed.focus()
  }, [])

  const insertWikiLink = useCallback((note: NoteMeta) => {
    const ed = editorRef.current; const pos = wikiPosRef.current
    if (!ed || !pos) return
    const cur = ed.getPosition(); if (!cur) return
    wikiPosRef.current = null
    setWikiPalette(p => ({ ...p, open: false }))
    const insertText = `[[${note.title}]]`
    const model = ed.getModel()
    // If Monaco auto-closed [[ → [[]], the ]] sits right after cursor — consume it
    const lineContent = model?.getLineContent(cur.lineNumber) ?? ''
    const afterCursor = lineContent.slice(cur.column - 1, cur.column + 1)
    const endCol = afterCursor === ']]' ? cur.column + 2 : cur.column
    ed.executeEdits('wiki-link', [{ range: new monaco.Range(pos.lineNumber, pos.column, cur.lineNumber, endCol), text: insertText }])
    ed.setPosition({ lineNumber: pos.lineNumber, column: pos.column + insertText.length })
    ed.focus()
  }, [])

  const doInsertRef      = useRef(doInsert)
  const closePalRef      = useRef(closePalette)
  const insertWikiRef    = useRef(insertWikiLink)
  const closeWikiRef     = useRef(closeWikiPalette)
  const insertTagRef     = useRef(insertTag)
  const closeTagRef      = useRef(closeTagPalette)
  doInsertRef.current    = doInsert
  closePalRef.current    = closePalette
  insertWikiRef.current  = insertWikiLink
  closeWikiRef.current   = closeWikiPalette
  insertTagRef.current   = insertTag
  closeTagRef.current    = closeTagPalette

  useEffect(() => {
    const el = containerRef.current; if (!el) return
    const handler = (e: KeyboardEvent) => {
      // Wiki link palette takes priority
      if (wikiPaletteRef.current.open) {
        if (e.key === 'Enter') {
          e.stopPropagation(); e.preventDefault()
          const note = wikiPaletteRef.current.notes[wikiPaletteRef.current.selectedIndex]
          if (note) insertWikiRef.current(note)
        } else if (e.key === 'ArrowDown') {
          e.stopPropagation(); e.preventDefault()
          setWikiPalette(p => ({ ...p, selectedIndex: Math.min(p.notes.length - 1, p.selectedIndex + 1) }))
        } else if (e.key === 'ArrowUp') {
          e.stopPropagation(); e.preventDefault()
          setWikiPalette(p => ({ ...p, selectedIndex: Math.max(0, p.selectedIndex - 1) }))
        } else if (e.key === 'Escape') {
          e.stopPropagation(); e.preventDefault(); closeWikiRef.current()
        }
        return
      }
      // Tag palette
      if (tagPaletteRef.current.open) {
        if (e.key === 'Enter') {
          e.stopPropagation(); e.preventDefault()
          const tag = tagPaletteRef.current.tags[tagPaletteRef.current.selectedIndex]
          if (tag) insertTagRef.current(tag)
        } else if (e.key === 'ArrowDown') {
          e.stopPropagation(); e.preventDefault()
          setTagPalette(p => ({ ...p, selectedIndex: Math.min(p.tags.length - 1, p.selectedIndex + 1) }))
        } else if (e.key === 'ArrowUp') {
          e.stopPropagation(); e.preventDefault()
          setTagPalette(p => ({ ...p, selectedIndex: Math.max(0, p.selectedIndex - 1) }))
        } else if (e.key === 'Escape') {
          e.stopPropagation(); e.preventDefault(); closeTagRef.current()
        }
        return
      }
      if (!paletteRef.current.open) return
      if (e.key === 'Enter') {
        e.stopPropagation(); e.preventDefault()
        const cmd = paletteRef.current.commands[paletteRef.current.selectedIndex]
        if (cmd) doInsertRef.current(cmd)
      } else if (e.key === 'ArrowDown') {
        e.stopPropagation(); e.preventDefault()
        setPalette(p => ({ ...p, selectedIndex: Math.min(p.commands.length - 1, p.selectedIndex + 1) }))
      } else if (e.key === 'ArrowUp') {
        e.stopPropagation(); e.preventDefault()
        setPalette(p => ({ ...p, selectedIndex: Math.max(0, p.selectedIndex - 1) }))
      } else if (e.key === 'Escape') {
        e.stopPropagation(); e.preventDefault(); closePalRef.current()
      }
    }
    el.addEventListener('keydown', handler, { capture: true })
    return () => el.removeEventListener('keydown', handler, { capture: true })
  }, [])

  const handleMount: OnMount = useCallback((ed) => {
    editorRef.current = ed
    monaco.editor.setTheme('liquid-glass-light')
    ed.addCommand(monaco.KeyCode.F1, () => {})
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => openFindRef.current(false))
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => openFindRef.current(true))
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
    })

    const wrapWithMarker = (marker: string) => {
      const model = ed.getModel(); const sel = ed.getSelection()
      if (!model || !sel) return
      const mLen = marker.length
      if (sel.isEmpty()) {
        const col = sel.startColumn
        ed.executeEdits('folio-format', [{ range: sel, text: marker + marker }])
        ed.setPosition({ lineNumber: sel.startLineNumber, column: col + mLen })
        ed.focus(); return
      }
      if (sel.startColumn > mLen) {
        const beforeRange = { startLineNumber: sel.startLineNumber, startColumn: sel.startColumn - mLen, endLineNumber: sel.startLineNumber, endColumn: sel.startColumn }
        const afterRange  = { startLineNumber: sel.endLineNumber,   startColumn: sel.endColumn,          endLineNumber: sel.endLineNumber,   endColumn: sel.endColumn + mLen }
        if (model.getValueInRange(beforeRange) === marker && model.getValueInRange(afterRange) === marker) {
          ed.executeEdits('folio-format', [{ range: afterRange, text: '' }, { range: beforeRange, text: '' }])
          ed.setSelection({ startLineNumber: sel.startLineNumber, startColumn: sel.startColumn - mLen, endLineNumber: sel.endLineNumber, endColumn: sel.endColumn - mLen })
          ed.focus(); return
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctrl = (ed as any).getContribution('snippetController2')
      if (ctrl?.insert) ctrl.insert(`${marker}\${TM_SELECTED_TEXT}${marker}`)
      else ed.executeEdits('folio-format', [{ range: sel, text: marker + model.getValueInRange(sel) + marker }])
      ed.focus()
    }

    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, () => wrapWithMarker('*'))
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => wrapWithMarker('_'))

    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, () => {
      onToggleSpellRef.current?.()
      const willBeEnabled = !spellEnabledRef.current
      setSpellToast(willBeEnabled ? 'enabled' : 'disabled')
      setTimeout(() => setSpellToast(null), 2000)
    })

    // List / checkbox continuation on Enter, Tab to indent, Shift+Tab to outdent
    ed.addCommand(monaco.KeyCode.Enter, () => {
      const model = ed.getModel(); const pos = ed.getPosition()
      if (!model || !pos) { ed.trigger('keyboard', 'type', { text: '\n' }); return }

      const line = model.getLineContent(pos.lineNumber)
      const listMatch = line.match(/^(\s*)(- \[x\] |- \[ \] |- |\+ )/)
      if (listMatch) {
        const indent = listMatch[1]
        const marker = listMatch[2]
        const cont = marker === '- [x] ' ? '- [ ] ' : marker
        const afterPrefix = line.slice(indent.length + marker.length)
        if (afterPrefix.trim() === '') {
          if (indent.length >= 2) {
            // Empty sublist item — outdent one level
            const newIndent = indent.slice(2)
            ed.executeEdits('list-continue', [{
              range: new monaco.Range(pos.lineNumber, 1, pos.lineNumber, line.length + 1),
              text: `${newIndent}${marker}`
            }])
            ed.setPosition({ lineNumber: pos.lineNumber, column: newIndent.length + marker.length + 1 })
          } else {
            // Empty top-level item — remove prefix, plain newline
            ed.executeEdits('list-continue', [{
              range: new monaco.Range(pos.lineNumber, 1, pos.lineNumber, line.length + 1),
              text: ''
            }])
            ed.trigger('keyboard', 'type', { text: '\n' })
          }
        } else {
          const curPos = ed.getPosition()!
          ed.executeEdits('list-continue', [{
            range: new monaco.Range(curPos.lineNumber, curPos.column, curPos.lineNumber, curPos.column),
            text: `\n${indent}${cont}`
          }])
          ed.setPosition({ lineNumber: curPos.lineNumber + 1, column: indent.length + cont.length + 1 })
        }
        return
      }

      // Table row continuation: line is one or more [cell], cells separated by commas
      const tableCells = line.trim().match(/^(\[[^\]]*\],?\s*)+$/)
      if (tableCells) {
        const cellCount = (line.match(/\[[^\]]*\]/g) ?? []).length
        if (cellCount > 0) {
          const newRow = Array(cellCount).fill('[]').join(', ') + ','
          ed.trigger('keyboard', 'type', { text: `\n${newRow}` })
          // Move cursor inside the first [] of the new row
          const newPos = ed.getPosition()
          if (newPos) {
            ed.setPosition({ lineNumber: newPos.lineNumber, column: newPos.column - newRow.length + 1 })
          }
          return
        }
      }

      ed.trigger('keyboard', 'type', { text: '\n' })
    })

    ed.addCommand(monaco.KeyCode.Tab, () => {
      const model = ed.getModel(); const pos = ed.getPosition()
      if (!model || !pos) return
      const line = model.getLineContent(pos.lineNumber)
      if (line.match(/^(\s*)(- \[x\] |- \[ \] |- |\+ )/)) {
        ed.executeEdits('list-indent', [{
          range: new monaco.Range(pos.lineNumber, 1, pos.lineNumber, 1),
          text: '  '
        }])
        ed.setPosition({ lineNumber: pos.lineNumber, column: pos.column + 2 })
        return
      }
      // Default: insert 2 spaces
      ed.executeEdits('tab', [{
        range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
        text: '  '
      }])
    })

    ed.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Tab, () => {
      const model = ed.getModel(); const pos = ed.getPosition()
      if (!model || !pos) return
      const line = model.getLineContent(pos.lineNumber)
      const indented = line.match(/^(\s+)(- \[x\] |- \[ \] |- |\+ )/)
      if (indented && indented[1].length >= 2) {
        ed.executeEdits('list-outdent', [{
          range: new monaco.Range(pos.lineNumber, 1, pos.lineNumber, 3),
          text: ''
        }])
        ed.setPosition({ lineNumber: pos.lineNumber, column: Math.max(1, pos.column - 2) })
        return
      }
      ed.trigger('keyboard', 'outdentLines', {})
    })

    ed.onMouseDown((e) => {
      // Cmd/Ctrl+click on [[...]] navigates to that note
      if (e.event.metaKey || e.event.ctrlKey) {
        const pos = e.target.position
        if (pos) {
          const model = ed.getModel()
          if (model) {
            const line = model.getLineContent(pos.lineNumber)
            const col = pos.column - 1
            // Walk outward to find enclosing [[...]]
            const before = line.slice(0, col + 1)
            const after = line.slice(col)
            const openIdx = before.lastIndexOf('[[')
            const closeIdx = after.indexOf(']]')
            if (openIdx !== -1 && closeIdx !== -1) {
              const title = line.slice(openIdx + 2, col + closeIdx).trim()
              if (title) { onNavigateRef.current(title); return }
            }
          }
        }
      }
      spellMouseDownRef.current(e)
    })

    ed.onDidChangeModelContent(() => {
      const pos = ed.getPosition(); if (!pos) return
      const line   = ed.getModel()?.getLineContent(pos.lineNumber) ?? ''
      const before = line.slice(0, pos.column - 1)

      // Wiki link palette: detect [[ trigger
      const wikiMatch = before.match(/\[\[([^\]]*)$/)
      if (wikiMatch) {
        if (!wikiPosRef.current || wikiPosRef.current.lineNumber !== pos.lineNumber) {
          wikiPosRef.current = { lineNumber: pos.lineNumber, column: pos.column - wikiMatch[0].length }
        }
        const query = wikiMatch[1].toLowerCase()
        const filtered = notesRef.current.filter(n => n.title.toLowerCase().includes(query))
        if (filtered.length === 0) { closeWikiRef.current(); } else {
          const pixelPos = ed.getScrolledVisiblePosition(pos)
          const rect = ed.getDomNode()?.getBoundingClientRect()
          if (pixelPos && rect) {
            setWikiPalette({ open: true, x: rect.left + pixelPos.left, y: rect.top + pixelPos.top + 22, notes: filtered, selectedIndex: 0 })
          }
        }
      } else {
        if (wikiPaletteRef.current.open) closeWikiRef.current()
      }

      // Tag palette: detect // @tags: line
      if (/^\/\/ @tags:/.test(line)) {
        const lastSep = Math.max(before.lastIndexOf(','), before.indexOf(':'))
        const afterSep = before.slice(lastSep + 1)
        const leadingSpaces = afterSep.length - afterSep.trimStart().length
        const partialCol = lastSep + 1 + leadingSpaces + 1  // 1-based column
        const partial = afterSep.trimStart()
        tagPosRef.current = { lineNumber: pos.lineNumber, column: partialCol }
        const allTags = [...new Set(notesRef.current.flatMap(n => n.tags))]
        const filtered = allTags.filter(t => t.toLowerCase().startsWith(partial.toLowerCase()) && t.toLowerCase() !== partial.toLowerCase())
        if (filtered.length === 0) {
          if (tagPaletteRef.current.open) closeTagRef.current()
        } else {
          const pixelPos = ed.getScrolledVisiblePosition(pos)
          const rect = ed.getDomNode()?.getBoundingClientRect()
          if (pixelPos && rect) {
            setTagPalette({ open: true, x: rect.left + pixelPos.left, y: rect.top + pixelPos.top + 22, tags: filtered, selectedIndex: 0 })
          }
        }
      } else {
        if (tagPaletteRef.current.open) closeTagRef.current()
      }

      const match  = before.match(/\/(\w*)$/)

      if (match) {
        const slashIdx = before.length - match[0].length
        const prevChar = before[slashIdx - 1]
        if (prevChar && /[a-zA-Z0-9:_]/.test(prevChar)) { closePalette(); return }

        if (!slashPosRef.current || slashPosRef.current.lineNumber !== pos.lineNumber) {
          slashPosRef.current = { lineNumber: pos.lineNumber, column: pos.column - match[0].length }
        }
        const commands = filterCommands(match[1])
        if (commands.length === 0) { closePalette(); return }

        const pixelPos = ed.getScrolledVisiblePosition(pos)
        const rect     = ed.getDomNode()?.getBoundingClientRect()
        if (pixelPos && rect) {
          setPalette({ open: true, x: rect.left + pixelPos.left, y: rect.top + pixelPos.top + 22, commands, selectedIndex: 0 })
        }
      } else {
        if (paletteRef.current.open) closePalette()
      }
    })

    ed.onDidChangeCursorPosition((e) => {
      const wiki = wikiPosRef.current
      if (wiki && (e.position.lineNumber !== wiki.lineNumber || e.position.column < wiki.column)) closeWikiRef.current()
      const tag = tagPosRef.current
      if (tag && (e.position.lineNumber !== tag.lineNumber || e.position.column < tag.column)) closeTagRef.current()
      const slash = slashPosRef.current; if (!slash) return
      if (e.position.lineNumber !== slash.lineNumber || e.position.column < slash.column) closePalette()
    })
  }, [closePalette])

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize })
  }, [fontSize])

  useEffect(() => {
    if (!focusTitleKey) return
    const ed = editorRef.current
    if (!ed) return
    setTimeout(() => {
      const model = ed.getModel()
      if (!model) { ed.focus(); return }
      const lineCount = model.getLineCount()
      for (let i = 1; i <= lineCount; i++) {
        const line = model.getLineContent(i)
        const m = line.match(/^={1,6}\s+(.+)$/)
        if (m) {
          const col = line.indexOf(m[1]) + 1
          ed.setSelection({ startLineNumber: i, startColumn: col, endLineNumber: i, endColumn: col + m[1].length })
          ed.revealLine(i)
          ed.focus()
          return
        }
      }
      ed.focus()
    }, 150)
  }, [focusTitleKey])

  // ── Image drag-and-drop ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current; if (!el) return
    const onDragOver = (e: DragEvent) => {
      const hasImage = Array.from(e.dataTransfer?.items ?? []).some(i => i.type.startsWith('image/'))
      if (hasImage) { e.preventDefault(); e.dataTransfer!.dropEffect = 'copy' }
    }
    const onDrop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? [])
      const imageFiles = files.filter(f => f.type.startsWith('image/'))
      if (imageFiles.length === 0) return
      e.preventDefault()
      imageFiles.forEach(file => {
        // Electron exposes the native path on the File object
        const nativePath = (file as File & { path?: string }).path
        if (!nativePath) return
        onDropImageRef.current(nativePath).then(filename => {
          if (filename) insertImageSnippet(filename)
        })
      })
    }
    const onPaste = async (e: ClipboardEvent) => {
      const imageItems = Array.from(e.clipboardData?.items ?? [])
        .filter(i => i.kind === 'file' && i.type.startsWith('image/'))
      if (imageItems.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      for (const item of imageItems) {
        const file = item.getAsFile(); if (!file) continue
        const ext = file.type.includes('png') ? 'png' : file.type.includes('gif') ? 'gif' : file.type.includes('webp') ? 'webp' : 'jpg'
        const buf = await file.arrayBuffer()
        const filename = await onPasteImageRef.current(new Uint8Array(buf), ext)
        if (filename) insertImageSnippet(filename)
      }
    }
    el.addEventListener('dragover', onDragOver)
    el.addEventListener('drop', onDrop)
    el.addEventListener('paste', onPaste, { capture: true })
    return () => {
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('drop', onDrop)
      el.removeEventListener('paste', onPaste, { capture: true })
    }
  }, [insertImageSnippet])

  return (
    <div ref={containerRef} style={{ flex: 1, overflow: 'hidden', minWidth: 0, position: 'relative' }}>
      <MonacoEditor
        height="100%"
        language={TYPST_LANGUAGE_ID}
        value={value}
        theme={isDark ? 'glyph-dark' : 'glyph-light'}
        onMount={handleMount}
        onChange={(v) => onChange(v ?? '')}
        options={{
          fontSize,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
          fontLigatures: true,
          lineHeight: 22,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          padding: { top: 20, bottom: 20 },
          renderLineHighlight: 'gutter',
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: false, indentation: true },
          lineNumbersMinChars: 3,
          overviewRulerLanes: 0,
          stickyScroll: { enabled: false },
          autoClosingBrackets: 'always',
          autoClosingQuotes: 'never',
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          wordBasedSuggestions: 'off',
          parameterHints: { enabled: false },
          contextmenu: false,
          scrollbar: { verticalScrollbarSize: 7, horizontalScrollbarSize: 7 },
          fixedOverflowWidgets: true
        }}
      />

      <SlashCommandPalette {...palette} onSelect={doInsert} onClose={closePalette} />
      <WikiLinkPalette {...wikiPalette} onSelect={insertWikiLink} onClose={closeWikiPalette} />
      <TagPalette {...tagPalette} onSelect={insertTag} onClose={closeTagPalette} />

      {emojiPickerOpen && (
        <EmojiPicker
          x={emojiPickerPos.x}
          y={emojiPickerPos.y}
          onInsert={(text, type) => {
            const ed = editorRef.current
            const slash = emojiSlashRef.current
            emojiSlashRef.current = null
            setEmojiPickerOpen(false)
            if (!ed || !slash) { ed?.focus(); return }
            const { sl, sc, el, ec } = slash
            const finalText = type === 'emoticon' ? `\`${text}\`` : text
            ed.executeEdits('emoji-insert', [{
              range: new monaco.Range(sl, sc, el, ec),
              text: finalText,
            }])
            ed.focus()
          }}
          onClose={() => {
            emojiSlashRef.current = null
            setEmojiPickerOpen(false)
            editorRef.current?.focus()
          }}
        />
      )}

      {bookmarkOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(4px)',
        }} onClick={() => { setBookmarkOpen(false); editorRef.current?.focus() }}>
          <form
            onClick={e => e.stopPropagation()}
            onSubmit={e => { e.preventDefault(); submitBookmark(bookmarkUrl) }}
            style={{
              background: 'var(--surface, #fff)', borderRadius: 12, padding: '20px 24px',
              boxShadow: '0 8px 40px rgba(0,0,0,0.18)', minWidth: 360,
              display: 'flex', flexDirection: 'column', gap: 12,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Web Bookmark</div>
            <input
              autoFocus
              type="url"
              placeholder="https://example.com"
              value={bookmarkUrl}
              onChange={e => setBookmarkUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setBookmarkOpen(false); editorRef.current?.focus() } }}
              style={{
                border: '1px solid var(--border, #e2e8f0)', borderRadius: 8,
                padding: '8px 12px', fontSize: 13, outline: 'none',
                background: 'var(--bg, #f8fafc)', color: 'var(--text)',
                width: '100%', boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { setBookmarkOpen(false); editorRef.current?.focus() }}
                style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border, #e2e8f0)', background: 'transparent', cursor: 'pointer', fontSize: 12 }}>
                Cancel
              </button>
              <button type="submit"
                style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--accent, #2563eb)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                Fetch
              </button>
            </div>
          </form>
        </div>
      )}

      {reminderOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(4px)',
        }} onClick={() => { setReminderOpen(false); editorRef.current?.focus() }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--surface, #fff)', borderRadius: 12, padding: '20px 24px',
              boxShadow: '0 8px 40px rgba(0,0,0,0.18)', minWidth: 300, maxWidth: 360,
              display: 'flex', flexDirection: 'column', gap: 12,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Set Reminder</div>
            {reminderQuickMode ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {([
                    { label: 'In 1 hour',  ms: 3_600_000 },
                    { label: 'Tomorrow',   ms: 86_400_000 },
                    { label: 'In 3 days',  ms: 3 * 86_400_000 },
                    { label: 'In 1 week',  ms: 7 * 86_400_000 },
                    { label: 'In 2 weeks', ms: 14 * 86_400_000 },
                    { label: 'In 1 month', ms: 30 * 86_400_000 },
                  ] as const).map(opt => {
                    const d = new Date(Date.now() + opt.ms)
                    return (
                      <button key={opt.label} onClick={() => confirmReminder(d)}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border, #e2e8f0)',
                          background: 'var(--bg, #f8fafc)', cursor: 'pointer', fontSize: 13,
                          color: 'var(--text)',
                        }}>
                        <span style={{ fontWeight: 500 }}>{opt.label}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted, #94a3b8)' }}>
                          {d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <button onClick={() => setReminderQuickMode(false)}
                  style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border, #e2e8f0)', background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'var(--accent, #2563eb)', fontWeight: 500 }}>
                  Choose date & time…
                </button>
              </>
            ) : (
              <>
                <input
                  autoFocus
                  type="datetime-local"
                  value={reminderDate}
                  min={toLocalInputValue(new Date())}
                  onChange={e => setReminderDate(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') { setReminderOpen(false); editorRef.current?.focus() } }}
                  style={{
                    border: '1px solid var(--border, #e2e8f0)', borderRadius: 8,
                    padding: '8px 12px', fontSize: 13, outline: 'none',
                    background: 'var(--bg, #f8fafc)', color: 'var(--text)',
                    width: '100%', boxSizing: 'border-box',
                  }}
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                  <button onClick={() => setReminderQuickMode(true)}
                    style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border, #e2e8f0)', background: 'transparent', cursor: 'pointer', fontSize: 12 }}>
                    ← Back
                  </button>
                  <button
                    disabled={!reminderDate}
                    onClick={() => { if (reminderDate) confirmReminder(new Date(reminderDate)) }}
                    style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--accent, #2563eb)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, opacity: reminderDate ? 1 : 0.5 }}>
                    Set Reminder
                  </button>
                </div>
              </>
            )}
            <button onClick={() => { setReminderOpen(false); editorRef.current?.focus() }}
              style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border, #e2e8f0)', background: 'transparent', cursor: 'pointer', fontSize: 12, alignSelf: 'flex-end' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <FindReplaceModal
        editorRef={editorRef}
        open={findOpen}
        showReplace={findShowReplace}
        query={findQuery}
        onQueryChange={setFindQuery}
        onShowReplaceChange={setFindShowReplace}
        onClose={() => setFindOpen(false)}
      />

      {spellPopup && (
        <SpellSuggestions
          popup={spellPopup}
          onReplace={replacement => replaceWord(spellPopup, replacement)}
          onAddToDictionary={() => { onAddToDict(spellPopup.word); closeSpellPopup() }}
          onClose={closeSpellPopup}
        />
      )}

      {spellToast && (
        <div style={{
          position: 'absolute', bottom: 48, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)',
          color: '#fff', borderRadius: 8, padding: '6px 14px',
          fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
          pointerEvents: 'none', zIndex: 200,
          animation: 'fadeIn 0.15s ease',
        }}>
          {spellToast === 'disabled' ? 'Spell check off for this note' : 'Spell check on for this note'}
        </div>
      )}

      {reminderToast && (
        <div style={{
          position: 'absolute', bottom: 48, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)',
          color: '#fff', borderRadius: 8, padding: '6px 14px',
          fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
          pointerEvents: 'none', zIndex: 200,
          animation: 'fadeIn 0.15s ease',
        }}>
          {reminderToast}
        </div>
      )}
    </div>
  )
}
