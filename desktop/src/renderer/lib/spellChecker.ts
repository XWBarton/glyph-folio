/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-ignore
import nspellFactory from 'nspell'
import affContent from '../assets/dict/en.aff?raw'
import dicContent from '../assets/dict/en.dic?raw'

type NSpell = {
  correct: (word: string) => boolean
  suggest: (word: string) => string[]
  add: (word: string) => NSpell
}

let _checker: NSpell | null = null

export function initChecker(): void {
  if (_checker) return
  _checker = nspellFactory(affContent, dicContent) as NSpell
}

export function reinitChecker(aff: string, dic: string): void {
  _checker = nspellFactory(aff, dic) as NSpell
}

export function resetToEnglish(): void {
  _checker = nspellFactory(affContent, dicContent) as NSpell
}

function getChecker(): NSpell {
  if (!_checker) _checker = nspellFactory(affContent, dicContent) as NSpell
  return _checker
}

export function isCorrect(word: string, customWords: Set<string>): boolean {
  if (customWords.has(word.toLowerCase())) return true
  try {
    return getChecker().correct(word)
  } catch {
    return true
  }
}

export function getSuggestions(word: string): string[] {
  try {
    return getChecker().suggest(word).slice(0, 6)
  } catch {
    return []
  }
}

export interface SpellError {
  word: string
  startLine: number // 1-based
  startCol: number  // 1-based
  endLine: number
  endCol: number
}

function isCheckableWord(word: string): boolean {
  if (word.length < 2) return false
  if (/\d/.test(word)) return false
  if (word.includes('_')) return false
  // Skip camelCase identifiers
  if (/[A-Z]/.test(word.slice(1)) && /[a-z]/.test(word)) return false
  // Must be mostly alphabetic (allow apostrophes and hyphens in the middle)
  if (!/^[a-zA-Z][a-zA-Z'-]*[a-zA-Z]$/.test(word)) return false
  return true
}

export function findMisspelled(content: string, customWords: Set<string>): SpellError[] {
  const errors: SpellError[] = []
  const lines = content.split('\n')

  let inBlockComment = false
  let inRawBlock = false

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]
    const lineNum = lineIdx + 1

    // Toggle raw block (```)
    const rawBlockMatches = (line.match(/```/g) || []).length
    if (rawBlockMatches % 2 !== 0) {
      inRawBlock = !inRawBlock
    }
    if (inRawBlock) continue

    // Toggle block comment /* ... */
    if (!inBlockComment && line.includes('/*')) inBlockComment = true
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false
      continue
    }

    // Skip line comments and headings with = markers
    const trimmed = line.trimStart()
    if (trimmed.startsWith('//')) continue

    let i = 0
    let inMath = false
    let inInlineCode = false

    while (i < line.length) {
      // Line comment
      if (!inMath && !inInlineCode && i + 1 < line.length && line[i] === '/' && line[i + 1] === '/') {
        break
      }

      // Inline code backtick
      if (line[i] === '`' && !inMath) {
        inInlineCode = !inInlineCode
        i++; continue
      }
      if (inInlineCode) { i++; continue }

      // Math $...$
      if (line[i] === '$') {
        inMath = !inMath
        i++; continue
      }
      if (inMath) { i++; continue }

      // Skip #command
      if (line[i] === '#') {
        i++
        while (i < line.length && /[\w.-]/.test(line[i])) i++
        continue
      }

      // Skip @reference
      if (line[i] === '@') {
        i++
        while (i < line.length && /[\w.-]/.test(line[i])) i++
        continue
      }

      // Skip <label>
      if (line[i] === '<') {
        while (i < line.length && line[i] !== '>') i++
        if (i < line.length) i++
        continue
      }

      // Skip URLs
      if (line[i] === 'h' && (line.slice(i, i + 7) === 'http://' || line.slice(i, i + 8) === 'https://')) {
        while (i < line.length && !/[\s,)>]/.test(line[i])) i++
        continue
      }

      // Word
      if (/[a-zA-Z]/.test(line[i])) {
        const start = i
        while (i < line.length && /[a-zA-Z'-]/.test(line[i])) i++
        // Trim trailing hyphens/apostrophes
        let end = i
        while (end > start && /['-]/.test(line[end - 1])) end--
        const word = line.slice(start, end)

        if (isCheckableWord(word) && !isCorrect(word, customWords)) {
          errors.push({ word, startLine: lineNum, startCol: start + 1, endLine: lineNum, endCol: end + 1 })
        }
        continue
      }

      i++
    }
  }

  return errors
}
