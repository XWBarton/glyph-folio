import { app, dialog } from 'electron'
import {
  readdirSync, readFileSync, writeFileSync, unlinkSync,
  existsSync, mkdirSync, statSync, rmSync, copyFileSync
} from 'fs'
import { join, basename, extname } from 'path'
import chokidar, { FSWatcher } from 'chokidar'
import { getStore } from './store'

export interface Note {
  id: string        // filename stem, e.g. "2025-04-04-my-note"
  title: string     // first heading or filename fallback
  tags: string[]    // parsed from "// @tags: ..." comment
  links: string[]   // titles referenced via [[Note Title]]
  body: string      // raw .typ content
  createdAt: string // ISO date string
  modifiedAt: string
  filePath: string
}

export interface NoteMeta {
  id: string
  title: string
  tags: string[]
  links: string[]
  createdAt: string
  modifiedAt: string
  filePath: string
}

export interface SearchResult extends NoteMeta {
  excerpt: string
  matchedIn: 'title' | 'tags' | 'body'
}

// ── Notes directory resolution ───────────────────────────────────────────────

export function resolveNotesDir(): string {
  const store = getStore()
  const syncMode = store.get('syncMode', 'local') as string

  if (syncMode === 'icloud') {
    const icloudBase = join(
      app.getPath('home'),
      'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'GlyphFolio'
    )
    if (existsSync(icloudBase)) return icloudBase
    try {
      mkdirSync(icloudBase, { recursive: true })
      return icloudBase
    } catch {}
  }

  const customDir = store.get('notesDir', '') as string
  if (customDir && existsSync(customDir)) return customDir

  // Use separate subdirectories so local and server notes never mix
  const subdir = syncMode === 'server' ? 'server' : 'local'
  const defaultDir = join(app.getPath('documents'), 'GlyphFolio', subdir)
  mkdirSync(defaultDir, { recursive: true })
  return defaultDir
}

// ── Title extraction ─────────────────────────────────────────────────────────

function extractTitle(body: string, id: string): string {
  const match = body.match(/^={1,6}\s+(.+)$/m)
  if (match) return match[1].trim()
  // Fall back to humanised filename stem (strip date prefix if present)
  const clean = id.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' ')
  return clean.charAt(0).toUpperCase() + clean.slice(1) || 'Untitled'
}

// ── Tag extraction ────────────────────────────────────────────────────────────

function extractTags(body: string): string[] {
  const match = body.match(/^\/\/ @tags:[ \t]*(.+)$/m)
  if (!match) return []
  return match[1].split(',').map(t => t.trim()).filter(Boolean)
}

// ── Link extraction ───────────────────────────────────────────────────────────

function extractLinks(body: string): string[] {
  const matches = [...body.matchAll(/\[\[([^\]]+)\]\]/g)]
  return [...new Set(matches.map(m => m[1].trim()))]
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export function listNotes(): NoteMeta[] {
  const dir = resolveNotesDir()
  const files = readdirSync(dir).filter(f => extname(f) === '.typ' && !f.startsWith('.'))
  return files.map(f => {
    const filePath = join(dir, f)
    const id = basename(f, '.typ')
    const stat = statSync(filePath)
    let body = ''
    try { body = readFileSync(filePath, 'utf8') } catch {}
    const datePrefix = id.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? stat.birthtime.toISOString().slice(0, 10)
    return {
      id,
      title: extractTitle(body, id),
      tags: extractTags(body),
      links: extractLinks(body),
      createdAt: new Date(datePrefix).toISOString(),
      modifiedAt: stat.mtime.toISOString(),
      filePath
    }
  }).sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
}

export function readNote(filePath: string): Note | null {
  try {
    const body = readFileSync(filePath, 'utf8')
    const stat = statSync(filePath)
    const id = basename(filePath, '.typ')
    const datePrefix = id.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? stat.birthtime.toISOString().slice(0, 10)
    return {
      id,
      title: extractTitle(body, id),
      tags: extractTags(body),
      links: extractLinks(body),
      body,
      createdAt: new Date(datePrefix).toISOString(),
      modifiedAt: stat.mtime.toISOString(),
      filePath
    }
  } catch {
    return null
  }
}

// Write a note by ID (used for sync — creates file if it doesn't exist)
export function upsertNote(id: string, body: string): { success: boolean; error?: string } {
  try {
    const dir = resolveNotesDir()
    writeFileSync(join(dir, `${id}.typ`), body, 'utf8')
    return { success: true }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

export function writeNote(filePath: string, body: string): { success: boolean; error?: string } {
  try {
    writeFileSync(filePath, body, 'utf8')
    return { success: true }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

export function deleteNote(filePath: string): { success: boolean; error?: string } {
  try {
    if (existsSync(filePath)) unlinkSync(filePath)
    return { success: true }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

export function createNote(title?: string): Note {
  const dir = resolveNotesDir()
  const date = new Date()
  const dateStr = date.toISOString().slice(0, 10)
  const slug = (title ?? 'note')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40) || 'note'
  let filename = `${dateStr}-${slug}.typ`
  let filePath = join(dir, filename)

  // Avoid collisions
  let counter = 1
  while (existsSync(filePath)) {
    filename = `${dateStr}-${slug}-${counter}.typ`
    filePath = join(dir, filename)
    counter++
  }

  const noteTitle = title ?? 'Untitled'
  const dateLabel = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) +
    ' · ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  const initialBody = [
    `// @tags: `,
    `#text(9pt, fill: gray)[${dateLabel}]`,
    '#line(length: 100%, stroke: 0.4pt + gray)',
    '',
    `= ${noteTitle}`,
    '',
    '',
  ].join('\n')
  writeFileSync(filePath, initialBody, 'utf8')

  return {
    id: basename(filePath, '.typ'),
    title: noteTitle,
    tags: [],
    links: [],
    body: initialBody,
    createdAt: date.toISOString(),
    modifiedAt: date.toISOString(),
    filePath
  }
}

// ── Attachments ──────────────────────────────────────────────────────────────

export function resolveAttachmentsDir(noteId: string): string {
  const dir = join(resolveNotesDir(), 'attachments', noteId)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function listAttachments(noteId: string): string[] {
  const dir = join(resolveNotesDir(), 'attachments', noteId)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => !f.startsWith('.'))
}

export function readAttachmentBuffer(noteId: string, filename: string): Buffer | null {
  const p = join(resolveNotesDir(), 'attachments', noteId, filename)
  if (!existsSync(p)) return null
  try { return readFileSync(p) } catch { return null }
}

export function writeAttachmentBuffer(noteId: string, filename: string, buffer: Buffer): void {
  const dir = resolveAttachmentsDir(noteId)
  writeFileSync(join(dir, filename), buffer)
}

export function deleteAttachmentFile(noteId: string, filename: string): void {
  const p = join(resolveNotesDir(), 'attachments', noteId, filename)
  if (existsSync(p)) unlinkSync(p)
}

export function deleteNoteAttachments(noteId: string): void {
  const dir = join(resolveNotesDir(), 'attachments', noteId)
  if (existsSync(dir)) try { rmSync(dir, { recursive: true }) } catch {}
}

/** Open a file-picker dialog and copy the chosen image into the note's attachments dir. */
export async function pickAndSaveAttachment(
  noteId: string
): Promise<{ filename: string } | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose image',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths[0]) return null
  const src = result.filePaths[0]
  const filename = basename(src)
  const dir = resolveAttachmentsDir(noteId)
  copyFileSync(src, join(dir, filename))
  return { filename }
}

/** Copy a file by path into the note's attachments dir (used for drag-and-drop). */
export function saveFileAsAttachment(
  noteId: string,
  srcPath: string
): { filename: string } {
  const filename = basename(srcPath)
  const dir = resolveAttachmentsDir(noteId)
  copyFileSync(srcPath, join(dir, filename))
  return { filename }
}

export function searchNotes(query: string): SearchResult[] {
  const q = query.toLowerCase().trim()
  if (!q) return []
  const dir = resolveNotesDir()
  const files = readdirSync(dir).filter(f => extname(f) === '.typ' && !f.startsWith('.'))
  const results: SearchResult[] = []

  for (const f of files) {
    const filePath = join(dir, f)
    const id = basename(f, '.typ')
    let body = ''
    let stat
    try { body = readFileSync(filePath, 'utf8'); stat = statSync(filePath) } catch { continue }
    const datePrefix = id.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? stat!.birthtime.toISOString().slice(0, 10)
    const title = extractTitle(body, id)
    const tags = extractTags(body)
    const links = extractLinks(body)

    const titleMatch = title.toLowerCase().includes(q)
    const tagMatch = tags.some(t => t.toLowerCase().includes(q))
    const bodyLower = body.toLowerCase()
    const bodyIdx = bodyLower.indexOf(q)
    const bodyMatch = bodyIdx !== -1 && !titleMatch && !tagMatch

    if (!titleMatch && !tagMatch && bodyIdx === -1) continue

    let excerpt = ''
    let matchedIn: SearchResult['matchedIn'] = titleMatch ? 'title' : tagMatch ? 'tags' : 'body'
    if (bodyMatch) {
      const start = Math.max(0, bodyIdx - 40)
      const end = Math.min(body.length, bodyIdx + q.length + 80)
      const raw = body.slice(start, end).replace(/\n/g, ' ').trim()
      excerpt = (start > 0 ? '…' : '') + raw + (end < body.length ? '…' : '')
    }

    results.push({
      id, title, tags, links,
      createdAt: new Date(datePrefix).toISOString(),
      modifiedAt: stat!.mtime.toISOString(),
      filePath, excerpt, matchedIn
    })
  }

  return results.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
}

export async function exportNotePdf(
  pdfBytes: number[],
  suggestedName: string
): Promise<{ success: boolean; error?: string }> {
  const result = await dialog.showSaveDialog({
    defaultPath: suggestedName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (result.canceled || !result.filePath) return { success: false }
  try {
    writeFileSync(result.filePath, Buffer.from(pdfBytes))
    return { success: true }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

// ── File watcher ─────────────────────────────────────────────────────────────

let watcher: FSWatcher | null = null

export function startWatcher(
  onChange: (event: 'add' | 'change' | 'unlink', filePath: string) => void
): void {
  const dir = resolveNotesDir()
  watcher = chokidar.watch(join(dir, '[!.]*.typ'), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
  })
  watcher.on('add', (p) => onChange('add', p))
  watcher.on('change', (p) => onChange('change', p))
  watcher.on('unlink', (p) => onChange('unlink', p))
}

export function stopWatcher(): void {
  watcher?.close()
  watcher = null
}

export function restartWatcher(
  onChange: (event: 'add' | 'change' | 'unlink', filePath: string) => void
): void {
  stopWatcher()
  startWatcher(onChange)
}
