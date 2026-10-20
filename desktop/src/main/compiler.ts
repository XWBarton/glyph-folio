import { app } from 'electron'
import { spawn, ChildProcess, execSync } from 'child_process'
import { join } from 'path'
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { resolveNotesDir, listBibFilenames, listBibKeys, ensurePreviewCache, PREVIEW_CACHE_DIR } from './notesManager'
import {
  mapLines, generatedLines, replaceMapped, replaceWholeLine, joinMapped, parseDiagnostics,
  type MappedLine, type CompileDiagnostic,
} from './sourceMap'

export type { CompileDiagnostic }

export type CitationStyle = 'numbered' | 'author-date'

function findTypstBin(): string {
  try {
    const cmd = process.platform === 'win32' ? 'where typst' : 'which typst'
    const found = execSync(cmd, { encoding: 'utf8' }).trim().split('\n')[0]
    if (found && existsSync(found)) return found
  } catch {}

  const candidates: string[] =
    process.platform === 'win32'
      ? [
          `${process.env.LOCALAPPDATA}\\Programs\\typst\\typst.exe`,
          `${process.env.USERPROFILE}\\.cargo\\bin\\typst.exe`,
          'C:\\Program Files\\typst\\typst.exe'
        ]
      : process.platform === 'darwin'
        ? [
            '/opt/homebrew/bin/typst',
            '/usr/local/bin/typst',
            `${process.env.HOME}/.cargo/bin/typst`
          ]
        : [
            '/usr/bin/typst',
            '/usr/local/bin/typst',
            `${process.env.HOME}/.cargo/bin/typst`
          ]

  return candidates.find(existsSync) ?? 'typst'
}

const TYPST_BIN = findTypstBin()

interface CompileSuccess { pdfBytes: Uint8Array }
interface CompileError   { error: string; diagnostics?: CompileDiagnostic[] }
type CompileResult = CompileSuccess | CompileError

let activeProcess: ChildProcess | null = null
let activeTempFiles: string[] = []

function cleanupTempFiles(files: string[]): void {
  for (const f of files) {
    try { if (existsSync(f)) unlinkSync(f) } catch {}
  }
}

const WIKILINK_DEF =
  '#let wikilink(it) = box(fill: rgb("#eff6ff"), stroke: 0.5pt + rgb("#93c5fd"), ' +
  'radius: 3pt, inset: (x: 3pt, y: 1pt), baseline: 1pt)' +
  '[#text(fill: rgb("#1d4ed8"), size: 0.9em)[#it]]\n'

/**
 * Rewrite the note's citation shorthand into explicit Typst #cite() calls:
 *   [@key]  (bracketed, possibly multiple "; "-separated) -> parenthetical, e.g. "(Masson et al., 2021)"
 *   @key    (bare)                                        -> narrative, e.g. "Masson et al. (2021)"
 * Only identifiers that are actually defined in a .bib file are touched — anything
 * else (e.g. @fig:results, @tab:summary, @eq:einstein) is left as plain Typst
 * reference syntax, so figure/table/equation/heading numbering and in-text links
 * keep working natively (Typst resolves `@label` to "Figure 1" etc. on its own).
 * Comment lines (// ...) are left untouched since Typst ignores them anyway.
 */
function preprocessCitations(line: MappedLine, knownKeys: Set<string>): MappedLine {
  if (knownKeys.size === 0 || /^\s*\/\//.test(line.text)) return line
  const bracketed = replaceMapped(line, /\[(@[\w:-]+(?:\s*;\s*@[\w:-]+)*)\]/g, (m, group: string) => {
    const parts = group.split(/\s*;\s*/)
    if (!parts.every(p => knownKeys.has(p.slice(1)))) return m
    return parts.map(part => `#cite(<${part.slice(1)}>)`).join(' ')
  })
  return replaceMapped(bracketed, /@([\w:-]+)/g, (m, key: string) => knownKeys.has(key) ? `#cite(<${key}>, form: "prose")` : m)
}

/**
 * In preview mode, redirect image() references to a downscaled
 * .preview-cache copy, so the live preview compiles and rasterizes faster.
 * The cache entry is created lazily on first use (e.g. attachments pasted
 * before preview caching existed), then reused on every later compile.
 * Originals (used for export) are never touched.
 */
function rewriteImagesForPreview(line: MappedLine): MappedLine {
  return replaceMapped(line, /image\("attachments\/([^/"]+)\/([^"]+)"/g, (match, noteId: string, filename: string) => {
    if (!ensurePreviewCache(noteId, filename)) return match
    return `image("attachments/${noteId}/${PREVIEW_CACHE_DIR}/${filename}"`
  })
}

/**
 * Compile a note body directly. The body is expected to contain its own
 * page/text setup and header (generated when the note is created).
 * Wiki links [[...]] are rendered as styled #wikilink[...] boxes.
 *
 * mode 'preview' substitutes downscaled cached images for a faster live
 * preview; mode 'export' always compiles against full-resolution originals.
 */
export async function compileNote(
  body: string,
  citationStyle: CitationStyle = 'author-date',
  mode: 'preview' | 'export' = 'export'
): Promise<CompileResult> {
  const hasLinks = /\[\[/.test(body)
  const knownKeys = listBibKeys()
  // Rewrite line by line, keeping a column map so Typst's error positions can
  // be translated back to the note (see sourceMap.ts).
  let lines: MappedLine[] = [
    ...(hasLinks ? generatedLines(WIKILINK_DEF.trimEnd()) : []),
    ...mapLines(body).map(line => {
      let l = preprocessCitations(line, knownKeys)
      l = replaceMapped(l, /\[\[([^\]]+)\]\]/g, (_m, inner: string) => `#wikilink[${inner}]`)
      if (l.text === '---') l = replaceWholeLine(l, '#line(length: 100%)')
      return l
    }),
  ]

  if (lines.some(l => l.text.includes('#cite('))) {
    const bibFiles = listBibFilenames()
    if (bibFiles.length > 0) {
      const styleName = citationStyle === 'numbered' ? 'ieee' : 'apa'
      const pathsArg = bibFiles.length === 1
        ? `"${bibFiles[0]}"`
        : `(${bibFiles.map(f => `"${f}"`).join(', ')})`
      // No title: the note supplies its own heading text if it wants one.
      const bibCall = `#bibliography(${pathsArg}, style: "${styleName}", title: none)`
      // A hand-written #bibliography(...) call marks where it should go; only the
      // first is honored (with its args replaced by the real ones) since Typst
      // rejects duplicates, and any extras are dropped. Otherwise append at the end.
      let injected = false
      lines = lines.map(l => {
        if (!/^\s*#bibliography\([^)]*\)\s*$/.test(l.text)) return l
        if (injected) return replaceWholeLine(l, '')
        injected = true
        return replaceWholeLine(l, bibCall)
      })
      if (!injected) lines.push(...generatedLines(bibCall), ...generatedLines(''))
    }
  }

  if (mode === 'preview') lines = lines.map(rewriteImagesForPreview)

  const result = await compileTypst(joinMapped(lines))
  if ('error' in result) {
    result.diagnostics = parseDiagnostics(result.error, lines, p => /\.glyph-folio-[0-9a-f-]+\.typ$/i.test(p))
  }
  return result
}

export async function compileTypst(content: string): Promise<CompileResult> {
  if (activeProcess) {
    activeProcess.kill()
    activeProcess = null
    cleanupTempFiles(activeTempFiles)
    activeTempFiles = []
  }

  const tmpDir    = app.getPath('temp')
  const notesDir  = resolveNotesDir()
  const id        = randomUUID()
  const inputPath  = join(notesDir, `.glyph-folio-${id}.typ`)   // must be under --root
  const outputPath = join(tmpDir,   `glyph-folio-${id}.pdf`)
  activeTempFiles = [inputPath, outputPath]

  writeFileSync(inputPath, content, 'utf8')

  return new Promise((resolve) => {
    const args = [
      'compile', inputPath, outputPath,
      '--root', resolveNotesDir(),
      '--diagnostic-format', 'short'
    ]
    // Ensure Homebrew and Cargo paths are included so package downloads work
    const env = {
      ...process.env,
      HOME: process.env['HOME'] ?? require('os').homedir(),
      PATH: [
        process.env['PATH'] ?? '',
        '/opt/homebrew/bin',
        '/usr/local/bin',
        `${process.env['HOME'] ?? require('os').homedir()}/.cargo/bin`,
      ].join(':'),
    }
    const child = spawn(TYPST_BIN, args, { env })
    activeProcess = child

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    child.on('close', (code) => {
      if (activeProcess === child) { activeProcess = null; activeTempFiles = [] }
      if (code === 0 && existsSync(outputPath)) {
        try {
          const buf = readFileSync(outputPath)
          cleanupTempFiles([inputPath, outputPath])
          resolve({ pdfBytes: new Uint8Array(buf) })
        } catch (e) {
          cleanupTempFiles([inputPath, outputPath])
          resolve({ error: String(e) })
        }
      } else {
        cleanupTempFiles([inputPath, outputPath])
        resolve({ error: stderr.trim() || `typst exited with code ${code}` })
      }
    })

    child.on('error', (err) => {
      cleanupTempFiles([inputPath, outputPath])
      resolve({ error: `Failed to run typst: ${err.message}` })
    })
  })
}
