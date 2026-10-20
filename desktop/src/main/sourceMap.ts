// Line/column bookkeeping for the note → Typst preprocessing in compiler.ts.
// The compiled file differs from the note (a prepended #wikilink helper,
// rewritten citations / wikilinks / image paths, an injected #bibliography),
// so Typst's diagnostic positions are mapped back through this.

export interface MappedLine {
  text: string
  /** Note line index (0-based), or null for generated lines. */
  line: number | null
  /** orig[i] = note column (0-based) of compiled char i; has text.length + 1 entries. */
  orig: number[]
}

export function mapLines(body: string): MappedLine[] {
  return body.split('\n').map((text, line) => ({
    text, line, orig: Array.from({ length: text.length + 1 }, (_, i) => i),
  }))
}

export function generatedLines(text: string): MappedLine[] {
  return text.split('\n').map(t => ({ text: t, line: null, orig: new Array(t.length + 1).fill(0) }))
}

/**
 * Regex replace on one line, keeping the column map. A replaced span maps
 * every new character to the start of the original match.
 */
export function replaceMapped(
  m: MappedLine,
  re: RegExp,
  fn: (match: string, ...groups: string[]) => string
): MappedLine {
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g'
  const global = new RegExp(re.source, flags)
  let text = ''
  const orig: number[] = []
  let last = 0
  for (const match of m.text.matchAll(global)) {
    const start = match.index ?? 0
    const replacement = fn(match[0], ...(match.slice(1) as string[]))
    text += m.text.slice(last, start)
    orig.push(...m.orig.slice(last, start))
    if (replacement === match[0]) {
      text += replacement
      orig.push(...m.orig.slice(start, start + replacement.length))
    } else {
      text += replacement
      for (let i = 0; i < replacement.length; i++) orig.push(m.orig[start])
    }
    last = start + match[0].length
  }
  text += m.text.slice(last)
  orig.push(...m.orig.slice(last))
  return { text, line: m.line, orig }
}

/** Replace a whole line's text; every column maps to the line start. */
export function replaceWholeLine(m: MappedLine, text: string): MappedLine {
  return { text, line: m.line, orig: new Array(text.length + 1).fill(m.orig[0] ?? 0) }
}

export function joinMapped(lines: MappedLine[]): string {
  return lines.map(l => l.text).join('\n')
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

export interface CompileDiagnostic {
  severity: 'error' | 'warning'
  message: string
  /** 1-based line/column in the note body, when the problem is in the note. */
  line?: number
  column?: number
  /** Set when the problem is in another file (e.g. a .bib or a package). */
  file?: string
  hints: string[]
}

const LOCATED_RE = /^(.*?):(\d+):(\d+): (error|warning): (.*)$/
const UNLOCATED_RE = /^(error|warning): (.*)$/

/**
 * Parse `typst --diagnostic-format short` output. Positions in the compiled
 * temp file are mapped back to the note through `lines`.
 */
export function parseDiagnostics(stderr: string, lines: MappedLine[], isNoteFile: (path: string) => boolean): CompileDiagnostic[] {
  const out: CompileDiagnostic[] = []
  for (const raw of stderr.split(/\r?\n/)) {
    const lineText = raw.trimEnd()
    if (!lineText.trim()) continue
    const located = lineText.match(LOCATED_RE)
    if (located) {
      const [, path, lineStr, colStr, severity, message] = located
      const d: CompileDiagnostic = { severity: severity as 'error' | 'warning', message, hints: [] }
      if (isNoteFile(path)) {
        const entry = lines[Number(lineStr) - 1]
        if (entry && entry.line !== null) {
          const col = Math.min(Number(colStr), entry.orig.length - 1)   // typst columns are 0-based
          d.line = entry.line + 1
          d.column = (entry.orig[col] ?? 0) + 1
        }
      } else {
        d.file = path.split(/[\\/]/).pop()
      }
      out.push(d)
      continue
    }
    const unlocated = lineText.match(UNLOCATED_RE)
    if (unlocated) {
      out.push({ severity: unlocated[1] as 'error' | 'warning', message: unlocated[2], hints: [] })
      continue
    }
    // Continuation (hint / note) lines belong to the previous diagnostic
    const prev = out[out.length - 1]
    const hint = lineText.trim().replace(/^(hint|help|note):\s*/, '')
    if (prev) prev.hints.push(hint)
    else out.push({ severity: 'error', message: hint, hints: [] })
  }
  return out
}
