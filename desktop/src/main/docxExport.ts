import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, Bookmark, SimpleField, ExternalHyperlink, PageBreak,
  LevelFormat, ShadingType, HighlightColor
} from 'docx'
import type { ParagraphChild } from 'docx'
import { resolveNotesDir, listBibFiles, type Note } from './notesManager'
import { parseBib, formatAuthors, firstAuthorLastName, type BibEntry } from '../renderer/lib/bibParser'
import { detectImageFormat, getImageDimensions } from './imageSize'
import type { CitationStyle } from './compiler'

// ── Block model ──────────────────────────────────────────────────────────────
// A small, purpose-built parser for the Typst subset the editor's slash
// commands actually generate (see slashCommands.ts) — not a general Typst
// parser. Anything outside that subset degrades gracefully (best-effort text
// extraction or is dropped), matching the documented v1 limitations.

interface ListItem { text: string; checked: boolean }

type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; checklist: boolean; items: ListItem[] }
  | {
      type: 'figure'
      figKind: 'image' | 'table'
      label?: string
      caption?: string
      image?: { path: string; widthPct: number }
      table?: { columns: number; cells: string[] }
    }
  | { type: 'quote'; text: string; attribution?: string }
  | { type: 'code'; text: string }
  | { type: 'divider' }
  | { type: 'pagebreak' }

// ── Balanced-bracket scanning ────────────────────────────────────────────────
// Typst source is well-formed, so tracking only one bracket kind at a time
// (ignoring the other kinds it may contain) is enough to find the matching
// close — mirrors the brace-depth scan already used in bibParser.ts.

function findMatchingClose(s: string, openIdx: number, openCh: string, closeCh: string): number {
  let depth = 1
  let i = openIdx + 1
  while (i < s.length && depth > 0) {
    if (s[i] === openCh) depth++
    else if (s[i] === closeCh) depth--
    i++
  }
  return i - 1
}

function extractBracketGroup(s: string, from: number): { content: string; end: number } | null {
  const open = s.indexOf('[', from)
  if (open === -1) return null
  const close = findMatchingClose(s, open, '[', ']')
  return { content: s.slice(open + 1, close), end: close + 1 }
}

function extractBracketGroupImmediatelyAfter(s: string, idx: number): { content: string; end: number } | null {
  if (s[idx] !== '[') return null
  const close = findMatchingClose(s, idx, '[', ']')
  return { content: s.slice(idx + 1, close), end: close + 1 }
}

// ── Multi-line construct parsing ─────────────────────────────────────────────

function parseFigure(body: string, hashIdx: number): { block: Block; endIdx: number } {
  const openParen = body.indexOf('(', hashIdx)
  const closeParen = findMatchingClose(body, openParen, '(', ')')
  const inner = body.slice(openParen + 1, closeParen)

  let caption: string | undefined
  const capMatch = /caption:\s*\[/.exec(inner)
  if (capMatch) {
    const capOpenRel = capMatch.index + capMatch[0].length - 1
    const capClose = findMatchingClose(inner, capOpenRel, '[', ']')
    caption = inner.slice(capOpenRel + 1, capClose).trim()
  }

  const after = body.slice(closeParen + 1)
  const labelMatch = /^\s*<([^>]+)>/.exec(after)
  const label = labelMatch?.[1]
  const endIdx = closeParen + 1 + (labelMatch ? labelMatch[0].length : 0)

  const imageMatch = /image\(/.exec(inner)
  const tableMatch = /table\(/.exec(inner)

  if (imageMatch && (!tableMatch || imageMatch.index < tableMatch.index)) {
    const openI = imageMatch.index + imageMatch[0].length - 1
    const closeI = findMatchingClose(inner, openI, '(', ')')
    const imgArgs = inner.slice(openI + 1, closeI)
    const pathMatch = /"([^"]+)"/.exec(imgArgs)
    const widthMatch = /width:\s*([\d.]+)%/.exec(imgArgs)
    return {
      block: {
        type: 'figure', figKind: 'image', label, caption,
        image: { path: pathMatch?.[1] ?? '', widthPct: widthMatch ? parseFloat(widthMatch[1]) : 100 }
      },
      endIdx
    }
  }

  if (tableMatch) {
    const openT = tableMatch.index + tableMatch[0].length - 1
    const closeT = findMatchingClose(inner, openT, '(', ')')
    const tblArgs = inner.slice(openT + 1, closeT)
    const columnsMatch = /columns:\s*\(([^)]*)\)/.exec(tblArgs)
    const columns = columnsMatch
      ? Math.max(1, columnsMatch[1].split(',').map(s => s.trim()).filter(Boolean).length)
      : 1
    const cellsStart = columnsMatch ? columnsMatch.index + columnsMatch[0].length : 0
    const cells: string[] = []
    let group = extractBracketGroup(tblArgs, cellsStart)
    while (group) {
      cells.push(group.content)
      group = extractBracketGroup(tblArgs, group.end)
    }
    return { block: { type: 'figure', figKind: 'table', label, caption, table: { columns, cells } }, endIdx }
  }

  // Unrecognised figure content (e.g. #figure(some-other-func(...))) — keep just the caption.
  return { block: { type: 'paragraph', text: caption ?? '' }, endIdx }
}

function parseQuote(body: string, hashIdx: number): { block: Block; endIdx: number } {
  const openParen = body.indexOf('(', hashIdx)
  const closeParen = findMatchingClose(body, openParen, '(', ')')
  const args = body.slice(openParen + 1, closeParen)
  let attribution: string | undefined
  const attrMatch = /attribution:\s*\[/.exec(args)
  if (attrMatch) {
    const attrOpenRel = attrMatch.index + attrMatch[0].length - 1
    const attrClose = findMatchingClose(args, attrOpenRel, '[', ']')
    attribution = args.slice(attrOpenRel + 1, attrClose).trim()
  }
  const group = extractBracketGroupImmediatelyAfter(body, closeParen + 1)
  const text = group?.content.trim() ?? ''
  const endIdx = group ? group.end : closeParen + 1
  return { block: { type: 'quote', text, attribution }, endIdx }
}

/** Best-effort fallback for any other #name(...)[...] call: keep the trailing content block as a plain paragraph. */
function parseGenericCall(body: string, hashIdx: number): { block: Block | null; endIdx: number } {
  const openParen = body.indexOf('(', hashIdx)
  const closeParen = findMatchingClose(body, openParen, '(', ')')
  const group = extractBracketGroupImmediatelyAfter(body, closeParen + 1)
  if (group) return { block: { type: 'paragraph', text: group.content.trim() }, endIdx: group.end }
  return { block: null, endIdx: closeParen + 1 }
}

// ── Top-level block splitter ─────────────────────────────────────────────────

function parseBlocks(body: string): Block[] {
  const blocks: Block[] = []
  const n = body.length
  let i = 0

  const lineEndFrom = (idx: number): number => {
    const nl = body.indexOf('\n', idx)
    return nl === -1 ? n : nl
  }

  while (i < n) {
    if (body[i] === '\n') { i++; continue }
    const lineEnd = lineEndFrom(i)
    const line = body.slice(i, lineEnd)
    const trimmed = line.trim()

    if (trimmed === '') { i = lineEnd + 1; continue }
    if (/^\/\//.test(trimmed)) { i = lineEnd + 1; continue }

    // Code fence
    if (trimmed.startsWith('```')) {
      const rest = body.slice(lineEnd + 1)
      const closeMatch = /(^|\n)```/.exec(rest)
      let codeEnd: number
      let afterCloseLineEnd: number
      if (!closeMatch) {
        codeEnd = n
        afterCloseLineEnd = n
      } else {
        const matchStart = closeMatch.index + (closeMatch[1] ? 1 : 0)
        codeEnd = lineEnd + 1 + matchStart
        afterCloseLineEnd = lineEndFrom(codeEnd)
      }
      blocks.push({ type: 'code', text: body.slice(lineEnd + 1, codeEnd) })
      i = Math.min(afterCloseLineEnd + 1, n)
      continue
    }

    // Heading
    const headingMatch = /^(=+)\s+(.+)$/.exec(trimmed)
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 6) as 1 | 2 | 3 | 4 | 5 | 6
      blocks.push({ type: 'heading', level, text: headingMatch[2].trim() })
      i = lineEnd + 1
      continue
    }

    // Divider
    if (trimmed === '---') { blocks.push({ type: 'divider' }); i = lineEnd + 1; continue }
    if (/^#line\(/.test(trimmed)) {
      const hashIdx = i + line.indexOf('#line(')
      const openParen = body.indexOf('(', hashIdx)
      const closeParen = findMatchingClose(body, openParen, '(', ')')
      blocks.push({ type: 'divider' })
      i = closeParen + 1
      if (body[i] === '\n') i++
      continue
    }

    // Page break
    if (/^#pagebreak\(\)/.test(trimmed)) { blocks.push({ type: 'pagebreak' }); i = lineEnd + 1; continue }

    // Style directives with no visible output
    if (/^#set\s+/.test(trimmed)) { i = lineEnd + 1; continue }

    // Figure (image or table)
    if (/^#figure\(/.test(trimmed)) {
      const hashIdx = i + line.indexOf('#figure(')
      const { block, endIdx } = parseFigure(body, hashIdx)
      blocks.push(block)
      i = endIdx
      if (body[i] === '\n') i++
      continue
    }

    // Quote
    if (/^#quote\(/.test(trimmed)) {
      const hashIdx = i + line.indexOf('#quote(')
      const { block, endIdx } = parseQuote(body, hashIdx)
      blocks.push(block)
      i = endIdx
      if (body[i] === '\n') i++
      continue
    }

    // Lists — group consecutive lines of the same kind
    const checklistMatch = /^-\s*\[( |x|X)\]\s*(.*)$/.exec(trimmed)
    const bulletMatch = !checklistMatch && /^-\s+(.*)$/.exec(trimmed)
    const numberedMatch = !checklistMatch && !bulletMatch && /^\+\s+(.*)$/.exec(trimmed)
    if (checklistMatch || bulletMatch || numberedMatch) {
      const ordered = !!numberedMatch
      const checklist = !!checklistMatch
      const items: ListItem[] = []
      let j = i
      while (j < n) {
        const jLineEnd = lineEndFrom(j)
        const jLine = body.slice(j, jLineEnd).trim()
        const jCheck = /^-\s*\[( |x|X)\]\s*(.*)$/.exec(jLine)
        const jBullet = !jCheck && /^-\s+(.*)$/.exec(jLine)
        const jNumbered = !jCheck && !jBullet && /^\+\s+(.*)$/.exec(jLine)
        const matchesKind = checklist ? !!jCheck : ordered ? !!jNumbered : !!jBullet
        if (!matchesKind) break
        if (jCheck) items.push({ text: jCheck[2].trim(), checked: /[xX]/.test(jCheck[1]) })
        else if (jBullet) items.push({ text: jBullet[1].trim(), checked: false })
        else if (jNumbered) items.push({ text: jNumbered[1].trim(), checked: false })
        j = jLineEnd + 1
      }
      blocks.push({ type: 'list', ordered, checklist, items })
      i = j
      continue
    }

    // Generic #name(...) or #name(...)[...] call — best-effort fallback
    if (/^#[a-zA-Z][\w-]*\(/.test(trimmed)) {
      const nameMatch = /^#([a-zA-Z][\w-]*)\(/.exec(trimmed)!
      const hashIdx = i + line.indexOf(`#${nameMatch[1]}(`)
      const { block, endIdx } = parseGenericCall(body, hashIdx)
      if (block) blocks.push(block)
      i = endIdx
      if (body[i] === '\n') i++
      continue
    }

    // Paragraph — merge consecutive plain lines until a blank line or a new construct.
    // A line that is just `\` (Typst's explicit line break) becomes a hard break.
    let j = i
    let text = ''
    while (j < n) {
      const jLineEnd = lineEndFrom(j)
      const jLine = body.slice(j, jLineEnd)
      const jTrimmed = jLine.trim()
      if (jTrimmed === '') break
      if (/^(=+)\s+/.test(jTrimmed)) break
      if (/^\/\//.test(jTrimmed)) break
      if (jTrimmed.startsWith('```')) break
      if (jTrimmed === '---') break
      if (/^#[a-zA-Z][\w-]*\(/.test(jTrimmed) && j !== i) break
      if (/^[-+]\s+/.test(jTrimmed) && j !== i) break
      if (jTrimmed === '\\') { text += '\n' } else { text += (text && !text.endsWith('\n') ? ' ' : '') + jTrimmed }
      j = jLineEnd + 1
    }
    blocks.push({ type: 'paragraph', text: text.trim() })
    i = j
  }

  return blocks
}

// ── Inline parsing ───────────────────────────────────────────────────────────

interface InlineCtx {
  knownBibKeys: Set<string>
  figureLabels: Map<string, FigureLabelInfo>
}

type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'break' }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'highlight'; text: string }
  | { kind: 'strike'; text: string }
  | { kind: 'sub'; text: string }
  | { kind: 'super'; text: string }
  | { kind: 'link'; url: string; label: string }
  | { kind: 'wikilink'; text: string }
  | { kind: 'citation'; keys: string[]; bracketed: boolean }
  | { kind: 'ref'; label: string }

function parseInline(text: string, ctx: InlineCtx): InlineToken[] {
  const tokens: InlineToken[] = []
  let textBuf = ''
  const flushText = () => {
    if (!textBuf) return
    const parts = textBuf.split('\n')
    parts.forEach((part, idx) => {
      if (part) tokens.push({ kind: 'text', text: part })
      if (idx < parts.length - 1) tokens.push({ kind: 'break' })
    })
    textBuf = ''
  }

  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)
    let m: RegExpExecArray | null

    if ((m = /^\*([^*\n]+)\*/.exec(rest))) { flushText(); tokens.push({ kind: 'bold', text: m[1] }); i += m[0].length; continue }
    if ((m = /^_([^_\n]+)_/.exec(rest))) { flushText(); tokens.push({ kind: 'italic', text: m[1] }); i += m[0].length; continue }

    if ((m = /^#highlight\[/.exec(rest))) {
      const close = findMatchingClose(text, i + m[0].length - 1, '[', ']')
      flushText(); tokens.push({ kind: 'highlight', text: text.slice(i + m[0].length, close) }); i = close + 1; continue
    }
    if ((m = /^#strike\[/.exec(rest))) {
      const close = findMatchingClose(text, i + m[0].length - 1, '[', ']')
      flushText(); tokens.push({ kind: 'strike', text: text.slice(i + m[0].length, close) }); i = close + 1; continue
    }
    if ((m = /^#sub\[/.exec(rest))) {
      const close = findMatchingClose(text, i + m[0].length - 1, '[', ']')
      flushText(); tokens.push({ kind: 'sub', text: text.slice(i + m[0].length, close) }); i = close + 1; continue
    }
    if ((m = /^#super\[/.exec(rest))) {
      const close = findMatchingClose(text, i + m[0].length - 1, '[', ']')
      flushText(); tokens.push({ kind: 'super', text: text.slice(i + m[0].length, close) }); i = close + 1; continue
    }
    if ((m = /^#link\("([^"]*)"\)\[/.exec(rest))) {
      const close = findMatchingClose(text, i + m[0].length - 1, '[', ']')
      flushText(); tokens.push({ kind: 'link', url: m[1], label: text.slice(i + m[0].length, close) }); i = close + 1; continue
    }
    if ((m = /^\[\[([^\]]+)\]\]/.exec(rest))) {
      flushText(); tokens.push({ kind: 'wikilink', text: m[1] }); i += m[0].length; continue
    }
    if ((m = /^\[(@[\w:-]+(?:\s*;\s*@[\w:-]+)*)\]/.exec(rest))) {
      const keys = m[1].split(/\s*;\s*/).map(k => k.slice(1))
      if (keys.every(k => ctx.knownBibKeys.has(k))) {
        flushText(); tokens.push({ kind: 'citation', keys, bracketed: true }); i += m[0].length; continue
      }
    }
    if ((m = /^@([\w:-]+)/.exec(rest))) {
      const key = m[1]
      if (ctx.knownBibKeys.has(key)) {
        flushText(); tokens.push({ kind: 'citation', keys: [key], bracketed: false }); i += m[0].length; continue
      }
      if (ctx.figureLabels.has(key)) {
        flushText(); tokens.push({ kind: 'ref', label: key }); i += m[0].length; continue
      }
    }

    textBuf += text[i]
    i++
  }
  flushText()
  return tokens
}

function sanitizeBookmarkId(label: string): string {
  const cleaned = label.replace(/[^A-Za-z0-9_]/g, '_')
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`
}

// ── Rendering ─────────────────────────────────────────────────────────────────

interface FigureLabelInfo { kindLabel: 'Figure' | 'Table'; number: number }

interface RenderCtx {
  knownBibKeys: Set<string>
  figureLabels: Map<string, FigureLabelInfo>
  bibMap: Map<string, BibEntry>
  citationStyle: CitationStyle
  citationIndex: Map<string, number>
  usedCitations: string[]
  citationCounter: { n: number }
}

function collectFigureLabels(blocks: Block[]): Map<string, FigureLabelInfo> {
  const labels = new Map<string, FigureLabelInfo>()
  let figCount = 0
  let tabCount = 0
  for (const b of blocks) {
    if (b.type !== 'figure') continue
    if (b.figKind === 'image') figCount++
    else tabCount++
    if (b.label) {
      labels.set(b.label, {
        kindLabel: b.figKind === 'image' ? 'Figure' : 'Table',
        number: b.figKind === 'image' ? figCount : tabCount
      })
    }
  }
  return labels
}

function renderCitation(keys: string[], bracketed: boolean, ctx: RenderCtx): TextRun[] {
  for (const key of keys) {
    if (!ctx.citationIndex.has(key)) {
      ctx.citationIndex.set(key, ctx.citationCounter.n++)
      ctx.usedCitations.push(key)
    }
  }

  if (ctx.citationStyle === 'numbered') {
    const nums = keys.map(k => ctx.citationIndex.get(k)!)
    return [new TextRun(`[${nums.join(', ')}]`)]
  }

  const labels = keys.map(key => {
    const entry = ctx.bibMap.get(key)
    const last = (entry ? firstAuthorLastName(entry.author) : undefined) ?? key
    const multiAuthor = entry?.author ? entry.author.split(/\s+and\s+/i).length > 1 : false
    return { authorLabel: multiAuthor ? `${last} et al.` : last, year: entry?.year ?? 'n.d.' }
  })
  if (!bracketed && labels.length === 1) {
    return [new TextRun(`${labels[0].authorLabel} (${labels[0].year})`)]
  }
  return [new TextRun(`(${labels.map(l => `${l.authorLabel}, ${l.year}`).join('; ')})`)]
}

function renderRef(label: string, ctx: RenderCtx): (SimpleField | TextRun)[] {
  const info = ctx.figureLabels.get(label)
  if (!info) return [new TextRun(`@${label}`)]
  const display = `${info.kindLabel} ${info.number}`
  return [new SimpleField(`REF ${sanitizeBookmarkId(label)} \\h`, display)]
}

function renderInlineChildren(text: string, ctx: RenderCtx, forceBold = false): ParagraphChild[] {
  const tokens = parseInline(text, ctx)
  const children: ParagraphChild[] = []
  for (const t of tokens) {
    switch (t.kind) {
      case 'text': children.push(new TextRun({ text: t.text, bold: forceBold || undefined })); break
      case 'break': children.push(new TextRun({ text: '', break: 1 })); break
      case 'bold': children.push(new TextRun({ text: t.text, bold: true })); break
      case 'italic': children.push(new TextRun({ text: t.text, italics: true, bold: forceBold || undefined })); break
      case 'highlight': children.push(new TextRun({ text: t.text, highlight: HighlightColor.YELLOW })); break
      case 'strike': children.push(new TextRun({ text: t.text, strike: true })); break
      case 'sub': children.push(new TextRun({ text: t.text, subScript: true })); break
      case 'super': children.push(new TextRun({ text: t.text, superScript: true })); break
      case 'link':
        children.push(new ExternalHyperlink({ link: t.url, children: [new TextRun({ text: t.label || t.url, style: 'Hyperlink' })] }))
        break
      case 'wikilink':
        children.push(new TextRun({ text: t.text, color: '1D4ED8' }))
        break
      case 'citation':
        children.push(...renderCitation(t.keys, t.bracketed, ctx))
        break
      case 'ref':
        children.push(...renderRef(t.label, ctx))
        break
    }
  }
  return children
}

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6
]

const MAX_IMAGE_WIDTH_PX = 550
const ORDERED_LIST_NUMBERING_REF = 'gf-numbered'

function renderImagePara(path: string, widthPct: number, notesDir: string): Paragraph {
  const absPath = join(notesDir, path)
  if (!existsSync(absPath)) {
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `[Image not found: ${path}]`, italics: true, color: '999999' })]
    })
  }
  const format = detectImageFormat(path)
  if (!format) {
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `[Image format not supported in Word export: ${path}]`, italics: true, color: '999999' })]
    })
  }
  const buf = readFileSync(absPath)
  const dims = getImageDimensions(buf, format)
  const naturalWidth = dims?.width ?? MAX_IMAGE_WIDTH_PX
  const naturalHeight = dims?.height ?? Math.round(MAX_IMAGE_WIDTH_PX * 0.66)
  const pct = Math.min(Math.max(widthPct, 5), 100)
  const baseWidth = Math.min(MAX_IMAGE_WIDTH_PX, naturalWidth)
  const targetWidth = Math.round(baseWidth * (pct / 100))
  const targetHeight = Math.max(1, Math.round(targetWidth * (naturalHeight / naturalWidth)))
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new ImageRun({ type: format, data: buf, transformation: { width: targetWidth, height: targetHeight } })]
  })
}

function renderTable(columns: number, cells: string[], ctx: RenderCtx): Table | null {
  if (cells.length === 0) return null
  const cols = Math.max(1, columns)
  const rows: TableRow[] = []
  const rowCount = Math.ceil(cells.length / cols)
  for (let r = 0; r < rowCount; r++) {
    const rowCells = cells.slice(r * cols, r * cols + cols)
    while (rowCells.length < cols) rowCells.push('')
    rows.push(new TableRow({
      children: rowCells.map(cellText => new TableCell({
        width: { size: Math.round(10000 / cols) / 100, type: WidthType.PERCENTAGE },
        shading: r === 0 ? { fill: 'F3F4F6', type: ShadingType.CLEAR, color: 'auto' } : undefined,
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
        children: [new Paragraph({ children: renderInlineChildren(cellText, ctx, r === 0) })]
      }))
    }))
  }
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
}

function renderCaptionPara(kindLabel: 'Figure' | 'Table', number: number, label: string | undefined, caption: string | undefined, ctx: RenderCtx): Paragraph {
  const numberRun = new TextRun({ text: `${kindLabel} ${number}`, bold: true })
  const prefix: ParagraphChild = label ? new Bookmark({ id: sanitizeBookmarkId(label), children: [numberRun] }) : numberRun
  const children: ParagraphChild[] = [prefix]
  if (caption) {
    children.push(new TextRun(': '))
    children.push(...renderInlineChildren(caption, ctx))
  }
  return new Paragraph({ children, alignment: AlignmentType.CENTER, spacing: { after: 240 } })
}

function bibEntryToRuns(e: BibEntry): TextRun[] {
  const runs: TextRun[] = []
  const authors = e.author ? formatAuthors(e.author) : ''
  const year = e.year ? `(${e.year})` : ''
  const header = [authors, year].filter(Boolean).join(' ')
  if (header) runs.push(new TextRun({ text: `${header}. `, bold: true }))
  if (e.title) runs.push(new TextRun({ text: `${e.title}. `, italics: true }))

  const type = e.type.toLowerCase()
  if (type === 'article') {
    const parts: string[] = []
    if (e.journal) parts.push(e.journal)
    if (e.volume && e.number) parts.push(`${e.volume}(${e.number})`)
    else if (e.volume) parts.push(e.volume)
    if (e.pages) parts.push(e.pages.replace(/--?/, '–'))
    if (parts.length) runs.push(new TextRun(`${parts.join(', ')}. `))
  } else if (type === 'inproceedings' || type === 'conference') {
    if (e.booktitle) runs.push(new TextRun(`In ${e.booktitle}. `))
  } else if (type === 'book' || type === 'incollection') {
    if (e.publisher) runs.push(new TextRun(`${e.publisher}. `))
    if (type === 'incollection' && e.booktitle) runs.push(new TextRun(`In ${e.booktitle}. `))
  }
  if (e.doi) runs.push(new TextRun(`doi: ${e.doi}`))
  return runs
}

function renderBibliographySection(ctx: RenderCtx): Paragraph[] {
  if (ctx.usedCitations.length === 0) return []
  const out: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'References', spacing: { before: 400, after: 200 } })
  ]

  const keys = ctx.citationStyle === 'numbered'
    ? ctx.usedCitations
    : [...ctx.usedCitations].sort((a, b) => {
        const la = (ctx.bibMap.get(a) ? firstAuthorLastName(ctx.bibMap.get(a)!.author) : undefined) ?? a
        const lb = (ctx.bibMap.get(b) ? firstAuthorLastName(ctx.bibMap.get(b)!.author) : undefined) ?? b
        return la.localeCompare(lb)
      })

  for (const key of keys) {
    const entry = ctx.bibMap.get(key)
    const prefix = ctx.citationStyle === 'numbered' ? `[${ctx.citationIndex.get(key)}] ` : ''
    const children: TextRun[] = [new TextRun(prefix)]
    children.push(...(entry ? bibEntryToRuns(entry) : [new TextRun(key)]))
    out.push(new Paragraph({ children, spacing: { after: 160 }, indent: { left: 360, hanging: 360 } }))
  }
  return out
}

function renderBlocks(blocks: Block[], ctx: RenderCtx, notesDir: string): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  let figRunning = 0
  let tabRunning = 0
  let orderedListInstance = 0

  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        out.push(new Paragraph({ heading: HEADING_LEVELS[b.level - 1], children: renderInlineChildren(b.text, ctx) }))
        break

      case 'paragraph':
        if (!b.text) break
        out.push(new Paragraph({ children: renderInlineChildren(b.text, ctx), spacing: { after: 160 } }))
        break

      case 'list': {
        const instance = b.ordered ? orderedListInstance++ : undefined
        for (const item of b.items) {
          const inlineChildren = renderInlineChildren(item.text, ctx)
          if (b.checklist) {
            out.push(new Paragraph({
              children: [new TextRun(item.checked ? '☑ ' : '☐ '), ...inlineChildren],
              indent: { left: 720 }
            }))
          } else if (b.ordered) {
            out.push(new Paragraph({ children: inlineChildren, numbering: { reference: ORDERED_LIST_NUMBERING_REF, level: 0, instance } }))
          } else {
            out.push(new Paragraph({ children: inlineChildren, bullet: { level: 0 } }))
          }
        }
        break
      }

      case 'figure':
        if (b.figKind === 'image') {
          figRunning++
          if (b.image) out.push(renderImagePara(b.image.path, b.image.widthPct, notesDir))
          out.push(renderCaptionPara('Figure', figRunning, b.label, b.caption, ctx))
        } else {
          tabRunning++
          const table = b.table ? renderTable(b.table.columns, b.table.cells, ctx) : null
          if (table) out.push(table)
          out.push(renderCaptionPara('Table', tabRunning, b.label, b.caption, ctx))
        }
        break

      case 'quote': {
        out.push(new Paragraph({
          children: renderInlineChildren(b.text, ctx),
          indent: { left: 480 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'CCCCCC', space: 8 } },
          spacing: { after: b.attribution ? 40 : 160 }
        }))
        if (b.attribution) {
          out.push(new Paragraph({
            children: [new TextRun({ text: `— ${b.attribution}`, italics: true })],
            indent: { left: 480 },
            spacing: { after: 160 }
          }))
        }
        break
      }

      case 'code':
        for (const line of b.text.split('\n')) {
          out.push(new Paragraph({
            children: [new TextRun({ text: line || ' ', font: 'Consolas' })],
            shading: { fill: 'F5F5F5', type: ShadingType.CLEAR, color: 'auto' },
            spacing: { after: 0 }
          }))
        }
        break

      case 'divider':
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } }, spacing: { after: 200 } }))
        break

      case 'pagebreak':
        out.push(new Paragraph({ children: [new PageBreak()] }))
        break
    }
  }

  return out
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function compileDocx(note: Note, citationStyle: CitationStyle): Promise<Buffer> {
  const notesDir = resolveNotesDir()
  const bibEntries = (await listBibFiles()).flatMap(parseBib)
  const bibMap = new Map(bibEntries.map(e => [e.key, e]))
  const knownBibKeys = new Set(bibMap.keys())

  const blocks = parseBlocks(note.body)
  const figureLabels = collectFigureLabels(blocks)

  const ctx: RenderCtx = {
    knownBibKeys, figureLabels, bibMap, citationStyle,
    citationIndex: new Map(), usedCitations: [], citationCounter: { n: 1 }
  }

  const bodyChildren = renderBlocks(blocks, ctx, notesDir)
  const bibliographyChildren = renderBibliographySection(ctx)

  const doc = new Document({
    features: { updateFields: true },
    numbering: {
      config: [{
        reference: ORDERED_LIST_NUMBERING_REF,
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } }
        }]
      }]
    },
    sections: [{ children: [...bodyChildren, ...bibliographyChildren] }]
  })

  return Packer.toBuffer(doc)
}
