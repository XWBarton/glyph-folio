import { spawn } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs'
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

export async function compileTypst(content: string): Promise<CompileResult> {
  const tmp        = tmpdir()
  const id         = randomUUID()
  const inputPath  = join(NOTES_DIR, `.glyph-folio-${id}.typ`)  // must be under --root
  const outputPath = join(tmp,       `glyph-folio-${id}.pdf`)

  writeFileSync(inputPath, content, 'utf8')

  return new Promise((resolve) => {
    const child = spawn(TYPST_BIN, [
      'compile', inputPath, outputPath,
      '--root', NOTES_DIR,
      '--diagnostic-format', 'short',
    ])

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    child.on('close', (code) => {
      try { if (existsSync(inputPath)) unlinkSync(inputPath) } catch {}
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
      try { if (existsSync(inputPath)) unlinkSync(inputPath) } catch {}
      resolve({ ok: false, error: `Failed to run typst: ${err.message}` })
    })
  })
}
