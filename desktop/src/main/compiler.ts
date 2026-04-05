import { app } from 'electron'
import { spawn, ChildProcess, execSync } from 'child_process'
import { join } from 'path'
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'

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

/**
 * Compile a note body directly. The body is expected to contain its own
 * page/text setup and header (generated when the note is created).
 * Wiki link syntax [[...]] is stripped to plain text before compilation.
 */
export async function compileNote(body: string): Promise<CompileResult> {
  const cleanBody = body.replace(/\[\[([^\]]+)\]\]/g, '$1')
  return compileTypst(cleanBody)
}

export async function compileTypst(content: string): Promise<CompileResult> {
  if (activeProcess) {
    activeProcess.kill()
    activeProcess = null
    cleanupTempFiles(activeTempFiles)
    activeTempFiles = []
  }

  const tmpDir = app.getPath('temp')
  const id = randomUUID()
  const inputPath  = join(tmpDir, `.glyph-folio-${id}.typ`)
  const outputPath = join(tmpDir, `glyph-folio-${id}.pdf`)
  activeTempFiles = [inputPath, outputPath]

  writeFileSync(inputPath, content, 'utf8')

  return new Promise((resolve) => {
    const args = [
      'compile', inputPath, outputPath,
      '--root', tmpDir,
      '--diagnostic-format', 'short'
    ]
    const child = spawn(TYPST_BIN, args)
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
