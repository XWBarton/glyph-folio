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

export type CompileResult =
  | { ok: true; pdfBase64: string }
  | { ok: false; error: string }

/**
 * Compiles typst content to PDF.
 *
 * If `noteId` is provided the note's attachment directory is copied into the
 * staging folder so that `image("attachments/{noteId}/{file}")` references
 * resolve correctly — independent of where NOTES_DIR lives on the server.
 */
export async function compileTypst(content: string, noteId?: string): Promise<CompileResult> {
  const tmp      = tmpdir()
  const id       = randomUUID()
  // Stage directory: everything lives here so relative paths work without --root
  const stageDir  = join(tmp, `glyph-stage-${id}`)
  const inputPath = join(stageDir, 'note.typ')
  const outputPath = join(tmp, `glyph-folio-${id}.pdf`)

  mkdirSync(stageDir, { recursive: true })
  writeFileSync(inputPath, content, 'utf8')

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
