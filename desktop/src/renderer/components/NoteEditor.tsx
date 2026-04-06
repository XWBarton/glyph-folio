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
import { FindReplaceModal } from './FindReplaceModal'
import { SpellSuggestions } from './SpellSuggestions'
import { useSpellCheck } from '../hooks/useSpellCheck'
import type { NoteMeta } from '../hooks/useNotes'

self.MonacoEnvironment = { getWorker: () => new editorWorker() }
loader.config({ monaco })

registerTypstLanguage(monaco)
monaco.editor.defineTheme('liquid-glass-light', buildMonacoTheme({}))

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

interface Props {
  value: string
  onChange: (value: string) => void
  tokenColors: TokenColors
  fontSize: number
  spellCheckEnabled: boolean
  customDictionary: string[]
  onAddToDict: (word: string) => void
  notes: NoteMeta[]
  onNavigate: (title: string) => void
}

export function NoteEditor({
  value, onChange, tokenColors, fontSize, spellCheckEnabled, customDictionary, onAddToDict,
  notes, onNavigate
}: Props) {
  useEffect(() => {
    monaco.editor.defineTheme('liquid-glass-light', buildMonacoTheme(tokenColors))
    monaco.editor.setTheme('liquid-glass-light')
  }, [tokenColors])

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

  const editorRef    = useRef<editor.IStandaloneCodeEditor | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const slashPosRef  = useRef<{ lineNumber: number; column: number } | null>(null)
  const notesRef     = useRef(notes)
  notesRef.current   = notes
  const onNavigateRef = useRef(onNavigate)
  onNavigateRef.current = onNavigate

  const { popup: spellPopup, closePopup: closeSpellPopup, handleMouseDown: spellMouseDown, replaceWord } =
    useSpellCheck(editorRef, value, customDictionary, spellCheckEnabled)
  const spellMouseDownRef = useRef(spellMouseDown)
  spellMouseDownRef.current = spellMouseDown

  const doInsert = useCallback((cmd: SlashCommand) => {
    const ed = editorRef.current; const slash = slashPosRef.current
    if (!ed || !slash) return
    const pos = ed.getPosition(); if (!pos) return
    slashPosRef.current = null
    setPalette(p => ({ ...p, open: false }))
    const { lineNumber: sl, column: sc } = slash
    const { lineNumber: el, column: ec } = pos

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

        // Insert checkbox item at (now shifted) cursor position
        const newPos = ed.getPosition()!
        const ctrl = ed.getContribution('snippetController2') as any
        if (ctrl?.insert) ctrl.insert('- [ ] ${1:item}\n- [ ] ${2:item}\n- [ ] $0')
        else ed.executeEdits('slash-checklist', [{ range: new monaco.Range(newPos.lineNumber, newPos.column, newPos.lineNumber, newPos.column), text: '- [ ] item\n- [ ] item\n- [ ] item' }])
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

  const insertWikiLink = useCallback((note: NoteMeta) => {
    const ed = editorRef.current; const pos = wikiPosRef.current
    if (!ed || !pos) return
    const cur = ed.getPosition(); if (!cur) return
    wikiPosRef.current = null
    setWikiPalette(p => ({ ...p, open: false }))
    setTimeout(() => {
      const insertText = `[[${note.title}]]`
      ed.setSelection(new monaco.Selection(pos.lineNumber, pos.column, cur.lineNumber, cur.column))
      ed.executeEdits('wiki-link', [{ range: ed.getSelection()!, text: insertText }])
      ed.focus()
    }, 0)
  }, [])

  const doInsertRef      = useRef(doInsert)
  const closePalRef      = useRef(closePalette)
  const insertWikiRef    = useRef(insertWikiLink)
  const closeWikiRef     = useRef(closeWikiPalette)
  doInsertRef.current    = doInsert
  closePalRef.current    = closePalette
  insertWikiRef.current  = insertWikiLink
  closeWikiRef.current   = closeWikiPalette

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
      const slash = slashPosRef.current; if (!slash) return
      if (e.position.lineNumber !== slash.lineNumber || e.position.column < slash.column) closePalette()
    })
  }, [closePalette])

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize })
  }, [fontSize])

  return (
    <div ref={containerRef} style={{ flex: 1, overflow: 'hidden', minWidth: 0, position: 'relative' }}>
      <MonacoEditor
        height="100%"
        language={TYPST_LANGUAGE_ID}
        value={value}
        theme="liquid-glass-light"
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
    </div>
  )
}
