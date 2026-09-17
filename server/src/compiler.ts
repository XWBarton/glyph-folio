import { spawn } from 'child_process'
import {
  writeFileSync, readFileSync, unlinkSync, existsSync,
  mkdirSync, readdirSync, copyFileSync, rmSync,
} from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { NOTES_DIR } from './storage'

function findTypstBin(): string {
  try {
    const cmd = process.platform === 'win32' ? 'where typst' : 'which typst'
    const found = execSync(cmd, { encoding: 'utf8' }).trim().split('\n')[0]
    if (found && existsSync(found)) return found
  } catch {}

  const candidates: string[] =
    process.platform === 'darwin'
      ? ['/opt/homebrew/bin/typst', '/usr/local/bin/typst', `${process.env.HOME}/.cargo/bin/typst`]
      : ['/usr/bin/typst', '/usr/local/bin/typst', `${process.env.HOME}/.cargo/bin/typst`]

  return candidates.find(existsSync) ?? 'typst'
}

const TYPST_BIN = findTypstBin()

export type CitationStyle = 'numbered' | 'author-date'

export type CompileResult =
  | { ok: true; pdfBase64: string }
  | { ok: false; error: string }

/** Filenames of all .bib files in the shared notes directory. */
function listBibFilenames(): string[] {
  try {
    return readdirSync(NOTES_DIR).filter(f => f.toLowerCase().endsWith('.bib'))
  } catch {
    return []
  }
}

/** All citation keys defined across every .bib file in the notes directory. */
function listBibKeys(): Set<string> {
  const keys = new Set<string>()
  for (const f of listBibFilenames()) {
    try {
      const content = readFileSync(join(NOTES_DIR, f), 'utf8')
      const re = /@\w+\s*\{\s*([^,\s]+)\s*,/g
      let m: RegExpExecArray | null
      while ((m = re.exec(content)) !== null) keys.add(m[1])
    } catch {}
  }
  return keys
}

/**
 * Rewrite citation shorthand into explicit Typst #cite() calls:
 *   [@key]  (bracketed, possibly multiple "; "-separated) -> parenthetical, e.g. "(Masson et al., 2021)"
 *   @key    (bare)                                        -> narrative, e.g. "Masson et al. (2021)"
 * Only identifiers that are actually defined in a .bib file are touched — anything
 * else (e.g. @fig:results, @tab:summary, @eq:einstein) is left as plain Typst
 * reference syntax, so figure/table/equation/heading numbering and in-text links
 * keep working natively (Typst resolves `@label` to "Figure 1" etc. on its own).
 * Comment lines (// ...) are left untouched since Typst ignores them anyway.
 */
function preprocessCitations(body: string, knownKeys: Set<string>): string {
  if (knownKeys.size === 0) return body
  return body
    .split('\n')
    .map(line => {
      if (/^\s*\/\//.test(line)) return line
      return line
        .replace(/\[(@[\w:-]+(?:\s*;\s*@[\w:-]+)*)\]/g, (m, group: string) => {
          const parts = group.split(/\s*;\s*/)
          if (!parts.every((p: string) => knownKeys.has(p.slice(1)))) return m
          return parts.map((part: string) => `#cite(<${part.slice(1)}>)`).join(' ')
        })
        .replace(/@([\w:-]+)/g, (m, key: string) => knownKeys.has(key) ? `#cite(<${key}>, form: "prose")` : m)
    })
    .join('\n')
}

/**
 * Compiles typst content to PDF.
 *
 * If `noteId` is provided the note's attachment directory is copied into the
 * staging folder so that `image("attachments/{noteId}/{file}")` references
 * resolve correctly — independent of where NOTES_DIR lives on the server.
 *
 * Citation shorthand (@key / [@key]) is rewritten to explicit #cite() calls and
 * a #bibliography() is generated automatically when any .bib file is present
 * and actually cited, styled per `citationStyle` (defaults to author-date).
 */
export async function compileTypst(content: string, noteId?: string, citationStyle: CitationStyle = 'author-date'): Promise<CompileResult> {
  const tmp      = tmpdir()
  const id       = randomUUID()
  // Stage directory: everything lives here so relative paths work without --root
  const stageDir  = join(tmp, `glyph-stage-${id}`)
  const inputPath = join(stageDir, 'note.typ')
  const outputPath = join(tmp, `glyph-folio-${id}.pdf`)

  mkdirSync(stageDir, { recursive: true })

  let cleanContent = preprocessCitations(content, listBibKeys())
    // Drop any hand-written #bibliography(...) call — one is generated below,
    // governed by the citation style, and Typst rejects duplicates.
    .replace(/^\s*#bibliography\([^)]*\)\s*$/gm, '')

  const bibFiles = listBibFilenames()
  if (cleanContent.includes('#cite(') && bibFiles.length > 0) {
    // Copy .bib files into the staging directory so the relative path resolves.
    for (const f of bibFiles) copyFileSync(join(NOTES_DIR, f), join(stageDir, f))
    const styleName = citationStyle === 'numbered' ? 'ieee' : 'apa'
    const pathsArg = bibFiles.length === 1
      ? `"${bibFiles[0]}"`
      : `(${bibFiles.map(f => `"${f}"`).join(', ')})`
    cleanContent += `\n#bibliography(${pathsArg}, style: "${styleName}")\n`
  }

  writeFileSync(inputPath, cleanContent, 'utf8')

  // Copy attachments into the staging directory so `image("attachments/…")` resolves
  if (noteId) {
    const attSrc = join(NOTES_DIR, 'attachments', noteId)
    if (existsSync(attSrc)) {
      const attDst = join(stageDir, 'attachments', noteId)
      mkdirSync(attDst, { recursive: true })
      for (const file of readdirSync(attSrc)) {
        copyFileSync(join(attSrc, file), join(attDst, file))
      }
    }
  }

  return new Promise((resolve) => {
    // No --root needed: typst resolves relative paths from the input file's directory
    const child = spawn(TYPST_BIN, [
      'compile', inputPath, outputPath,
      '--diagnostic-format', 'short',
    ])

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    child.on('close', (code) => {
      try { rmSync(stageDir, { recursive: true, force: true }) } catch {}
      if (code === 0 && existsSync(outputPath)) {
        try {
          const pdfBase64 = readFileSync(outputPath).toString('base64')
          try { unlinkSync(outputPath) } catch {}
          resolve({ ok: true, pdfBase64 })
        } catch (e) {
          resolve({ ok: false, error: String(e) })
        }
      } else {
        try { if (existsSync(outputPath)) unlinkSync(outputPath) } catch {}
        resolve({ ok: false, error: stderr.trim() || `typst exited with code ${code}` })
      }
    })

    child.on('error', (err) => {
      try { rmSync(stageDir, { recursive: true, force: true }) } catch {}
      resolve({ ok: false, error: `Failed to run typst: ${err.message}` })
    })
  })
}
