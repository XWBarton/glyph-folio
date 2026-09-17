import { app } from 'electron'
import { spawn, ChildProcess, execSync } from 'child_process'
import { join } from 'path'
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { resolveNotesDir, listBibFilenames, listBibKeys } from './notesManager'

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
interface CompileError   { error: string }
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
function preprocessCitations(body: string, knownKeys: Set<string>): string {
  if (knownKeys.size === 0) return body
  return body
    .split('\n')
    .map(line => {
      if (/^\s*\/\//.test(line)) return line
      return line
        .replace(/\[(@[\w:-]+(?:\s*;\s*@[\w:-]+)*)\]/g, (m, group: string) => {
          const parts = group.split(/\s*;\s*/)
          if (!parts.every(p => knownKeys.has(p.slice(1)))) return m
          return parts.map(part => `#cite(<${part.slice(1)}>)`).join(' ')
        })
        .replace(/@([\w:-]+)/g, (m, key: string) => knownKeys.has(key) ? `#cite(<${key}>, form: "prose")` : m)
    })
    .join('\n')
}

/**
 * Compile a note body directly. The body is expected to contain its own
 * page/text setup and header (generated when the note is created).
 * Wiki links [[...]] are rendered as styled #wikilink[...] boxes.
 */
export async function compileNote(body: string, citationStyle: CitationStyle = 'author-date'): Promise<CompileResult> {
  const hasLinks = /\[\[/.test(body)
  const knownKeys = listBibKeys()
  let cleanBody = (hasLinks ? WIKILINK_DEF : '')
    + preprocessCitations(body, knownKeys)
      .replace(/\[\[([^\]]+)\]\]/g, '#wikilink[$1]')
      .replace(/^---$/gm, '#line(length: 100%)')
      // Drop any hand-written #bibliography(...) call — one is generated below,
      // governed by the citation style setting, and Typst rejects duplicates.
      .replace(/^\s*#bibliography\([^)]*\)\s*$/gm, '')

  if (cleanBody.includes('#cite(')) {
    const bibFiles = listBibFilenames()
    if (bibFiles.length > 0) {
      const styleName = citationStyle === 'numbered' ? 'ieee' : 'apa'
      const pathsArg = bibFiles.length === 1
        ? `"${bibFiles[0]}"`
        : `(${bibFiles.map(f => `"${f}"`).join(', ')})`
      cleanBody += `\n#bibliography(${pathsArg}, style: "${styleName}")\n`
    }
  }

  return compileTypst(cleanBody)
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
