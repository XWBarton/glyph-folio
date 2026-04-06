import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, statSync, rmSync } from 'fs'
import { join, basename, extname } from 'path'

export const NOTES_DIR = join(process.cwd(), 'data', 'notes')

export function ensureNotesDir(): void {
  mkdirSync(NOTES_DIR, { recursive: true })
}

function extractTitle(body: string, id: string): string {
  const match = body.match(/^={1,6}\s+(.+)$/m)
  if (match) return match[1].trim()
  const clean = id.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' ')
  return clean.charAt(0).toUpperCase() + clean.slice(1) || 'Untitled'
}

export interface NoteMeta {
  id: string
  title: string
  createdAt: string
  modifiedAt: string
}

export function listNotes(): NoteMeta[] {
  ensureNotesDir()
  return readdirSync(NOTES_DIR)
    .filter(f => extname(f) === '.typ' && !f.startsWith('.'))
    .map(f => {
      const id = basename(f, '.typ')
      const filePath = join(NOTES_DIR, f)
      const stat = statSync(filePath)
      let body = ''
      try { body = readFileSync(filePath, 'utf8') } catch {}
      const datePrefix = id.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? stat.birthtime.toISOString().slice(0, 10)
      return {
        id,
        title: extractTitle(body, id),
        createdAt: new Date(datePrefix).toISOString(),
        modifiedAt: stat.mtime.toISOString(),
      }
    })
    .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
}

export function readNote(id: string): { id: string; title: string; body: string; modifiedAt: string } | null {
  ensureNotesDir()
  const filePath = join(NOTES_DIR, `${id}.typ`)
  if (!existsSync(filePath)) return null
  try {
    const body = readFileSync(filePath, 'utf8')
    const stat = statSync(filePath)
    return { id, title: extractTitle(body, id), body, modifiedAt: stat.mtime.toISOString() }
  } catch {
    return null
  }
}

export function writeNote(id: string, body: string): void {
  ensureNotesDir()
  writeFileSync(join(NOTES_DIR, `${id}.typ`), body, 'utf8')
}

export function deleteNote(id: string): void {
  const filePath = join(NOTES_DIR, `${id}.typ`)
  if (existsSync(filePath)) unlinkSync(filePath)
  deleteNoteAttachments(id)
}

// ── Attachments ───────────────────────────────────────────────────────────────

function attachmentsDir(noteId: string): string {
  return join(NOTES_DIR, 'attachments', noteId)
}

export function ensureAttachmentsDir(noteId: string): string {
  const dir = attachmentsDir(noteId)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function listAttachments(noteId: string): string[] {
  const dir = attachmentsDir(noteId)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => !f.startsWith('.'))
}

export function writeAttachment(noteId: string, filename: string, buffer: Buffer): void {
  const dir = ensureAttachmentsDir(noteId)
  writeFileSync(join(dir, filename), buffer)
}

export function readAttachment(noteId: string, filename: string): Buffer | null {
  const filePath = join(attachmentsDir(noteId), filename)
  if (!existsSync(filePath)) return null
  try { return readFileSync(filePath) } catch { return null }
}

export function deleteAttachment(noteId: string, filename: string): void {
  const filePath = join(attachmentsDir(noteId), filename)
  if (existsSync(filePath)) unlinkSync(filePath)
}

export function deleteNoteAttachments(noteId: string): void {
  const dir = attachmentsDir(noteId)
  if (existsSync(dir)) try { rmSync(dir, { recursive: true }) } catch {}
}
