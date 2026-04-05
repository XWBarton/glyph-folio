import { useEffect, useRef, useState, useCallback } from 'react'
import * as monaco from 'monaco-editor'
import type { editor } from 'monaco-editor'
import { findMisspelled, getSuggestions, initChecker, type SpellError } from '../lib/spellChecker'

export interface SpellPopup {
  word: string
  suggestions: string[]
  x: number
  y: number
  startLine: number
  startCol: number
  endLine: number
  endCol: number
}

// Inject decoration CSS once
if (!document.getElementById('glyph-spell-styles')) {
  const style = document.createElement('style')
  style.id = 'glyph-spell-styles'
  style.textContent = `
    .glyph-spell-error {
      text-decoration: underline wavy rgba(239, 68, 68, 0.7);
      text-decoration-skip-ink: none;
    }
  `
  document.head.appendChild(style)
}

function posInError(pos: monaco.Position, err: SpellError): boolean {
  if (pos.lineNumber < err.startLine || pos.lineNumber > err.endLine) return false
  if (pos.lineNumber === err.startLine && pos.column < err.startCol) return false
  if (pos.lineNumber === err.endLine && pos.column > err.endCol) return false
  return true
}

export function useSpellCheck(
  editorRef: React.MutableRefObject<editor.IStandaloneCodeEditor | null>,
  content: string,
  customWords: string[],
  enabled: boolean
) {
  const [popup, setPopup] = useState<SpellPopup | null>(null)
  const errorsRef = useRef<SpellError[]>([])
  const collectionRef = useRef<editor.IEditorDecorationsCollection | null>(null)
  const customWordSet = useRef(new Set<string>())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  // Lazy-init checker off the critical path
  useEffect(() => {
    const t = setTimeout(() => initChecker(), 200)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    customWordSet.current = new Set(customWords.map(w => w.toLowerCase()))
  }, [customWords])

  const runCheck = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return

    if (!collectionRef.current) {
      collectionRef.current = ed.createDecorationsCollection([])
    }

    if (!enabledRef.current) {
      collectionRef.current.clear()
      errorsRef.current = []
      setPopup(null)
      return
    }

    const errors = findMisspelled(content, customWordSet.current)
    errorsRef.current = errors
    collectionRef.current.set(
      errors.map(err => ({
        range: new monaco.Range(err.startLine, err.startCol, err.endLine, err.endCol),
        options: {
          inlineClassName: 'glyph-spell-error',
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        }
      }))
    )
  }, [content, editorRef])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(runCheck, 800)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [content, enabled, customWords, runCheck])

  // Replace a misspelled word with a suggestion
  const replaceWord = useCallback((p: SpellPopup, replacement: string) => {
    const ed = editorRef.current
    if (!ed) return
    ed.executeEdits('spell-fix', [{
      range: new monaco.Range(p.startLine, p.startCol, p.endLine, p.endCol),
      text: replacement,
    }])
    ed.focus()
    setPopup(null)
  }, [editorRef])

  // Show popup if click lands on a spell error
  const handleMouseDown = useCallback((e: editor.IEditorMouseEvent) => {
    if (!enabledRef.current) return
    // Dismiss if not clicking on text
    if (e.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) {
      setPopup(null)
      return
    }
    const pos = e.target.position
    if (!pos) { setPopup(null); return }

    const error = errorsRef.current.find(err => posInError(pos, err))
    if (!error) { setPopup(null); return }

    const ed = editorRef.current
    if (!ed) return
    const pixelPos = ed.getScrolledVisiblePosition(pos)
    const rect = ed.getDomNode()?.getBoundingClientRect()
    if (!pixelPos || !rect) return

    setPopup({
      word: error.word,
      suggestions: getSuggestions(error.word),
      x: rect.left + pixelPos.left,
      y: rect.top + pixelPos.top + 24,
      startLine: error.startLine,
      startCol: error.startCol,
      endLine: error.endLine,
      endCol: error.endCol,
    })
  }, [editorRef])

  const closePopup = useCallback(() => setPopup(null), [])

  return { popup, closePopup, handleMouseDown, replaceWord }
}
