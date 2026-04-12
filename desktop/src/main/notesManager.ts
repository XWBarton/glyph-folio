import { app, dialog } from 'electron'
import {
  readdirSync, readFileSync, writeFileSync, unlinkSync,
  existsSync, mkdirSync, statSync, rmSync, copyFileSync, utimesSync
} from 'fs'
import { join, basename, extname } from 'path'
import { execFileSync } from 'child_process'
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
  // Explicit override: // = Title (commented-out heading, not rendered in PDF)
  const override = body.match(/^\/\/\s*=\s+(.+)$/m)
  if (override) return override[1].trim()
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
export function upsertNote(id: string, body: string, mtime?: string): { success: boolean; error?: string } {
  try {
    const dir = resolveNotesDir()
    const filePath = join(dir, `${id}.typ`)
    writeFileSync(filePath, body, 'utf8')
    if (mtime) {
      const d = new Date(mtime)
      utimesSync(filePath, d, d)
    }
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function renameWikiLinks(oldTitle: string, newTitle: string, excludeFilePath: string): string[] {
  if (!oldTitle || !newTitle || oldTitle === newTitle) return []
  const dir = resolveNotesDir()
  const files = readdirSync(dir).filter(f => extname(f) === '.typ' && !f.startsWith('.'))
  const needle = `[[${oldTitle}]]`
  const pattern = new RegExp(`\\[\\[${escapeRegex(oldTitle)}\\]\\]`, 'g')
  const modified: string[] = []
  for (const f of files) {
    const filePath = join(dir, f)
    if (filePath === excludeFilePath) continue
    let body = ''
    try { body = readFileSync(filePath, 'utf8') } catch { continue }
    if (!body.includes(needle)) continue
    const newBody = body.replace(pattern, `[[${newTitle}]]`)
    try { writeFileSync(filePath, newBody, 'utf8') } catch { continue }
    modified.push(filePath)
  }
  return modified
}

// ── Tutorial note seeding ────────────────────────────────────────────────────

function makeTutorialBody(dateLabel: string): string {
  const b = '`'
  return [
    '// @tags: tutorial',
    '// = Getting Started',
    `#text(9pt, fill: gray)[${dateLabel}]`,
    '#line(length: 100%, stroke: 0.4pt + gray)',
    '',
    'Notes start with a tag string that is commented out: ',
    `${b}${b}${b}typst`,
    '// @tags: testing, another-tag',
    `${b}${b}${b}`,
    'Glyph Folio will observe these tags for you to filter and visualise but will not be rendered in your note. ',
    '',
    '#line(length: 100%)',
    '',
    'The note title will come from the first primary header but can be overridden by a commented primary header below the tag comment.',
    '',
    `${b}${b}${b}typst`,
    '// = Tutorial Note',
    `${b}${b}${b}`,
    '',
    '#line(length: 100%)',
    '',
    'The next two lines automatically insert the time and date of the note creation to the top of the note. It can be removed or edited if desired. ',
    '',
    `${b}${b}${b}typst`,
    `#text(9pt, fill: gray)[${dateLabel}]`,
    '#line(length: 100%, stroke: 0.4pt + gray)',
    `${b}${b}${b}`,
    '',
    '#line(length: 100%)',
    '',
    '= Basic Typst Formatting',
    '\\',
    '#table(',
    '  columns: (1fr, 1fr, 2fr),',
    '  [*Symbol*], [*Function*], [*Note*],',
    `  [${b}=${b}], [Header], [h1 is =, h2 is ==, h3 is === etc],`,
    `  [${b}*Glyph Folio*${b}], [Bold], [Wrap a word in a star to bold things],`,
    `  [${b}_Glyph Folio_${b}], [italicise], [Wrap a word in underscore to italicise things],`,
    `  [${b}-${b}], [Bullet lists], [],`,
    `  [${b}+${b}], [Ordered lists], [],`,
    `  [${b}//${b}], [Comment], [Text after this will not be rendered],`,
    `  [${b}\\${b}${b}], [New line], [],`,
    ')',
    '',
    'There are lots of things you can do, check out #text(fill: rgb("#0000EE"))[#link("https://typst.app/docs/reference/syntax/")[Typst]] for way more. ',
    '',
    '= Glyph Folio Features',
    '',
    '== Extensions of Typst Syntax',
    `Use slash commands to quickly autofill many of these typst syntax features. Check it out type ${b}/tab${b} and enter to fill a table format.`,
    '\\',
    '\\',
    'Glyph Folio has a couple of extra / extended commands:',
    `- ${b}/tag${b} will send your cursor to the tags at the top of the page so you can categorise your note and visualise in the graph view (described below)`,
    `- Pressing ${b}[[${b} will allow you to link another page which can also be visualised in the graph view (also described below)`,
    `- ${b}/check${b} will import the ${b}cheq${b} typst module to give a pretty checkbox format`,
    `- ${b}/bookmark${b} will let you enter a URL and put a web bookmark and will pull the web page details and an image if it can.`,
    '\\',
    '#block(stroke: 0.5pt + luma(215), radius: 6pt, inset: 10pt, width: 100%)[',
    '  #link("https://typst.app/")[*Typst: The new foundation for documents*]\\',
    '  #text(size: 9pt, fill: luma(110))[Typst is the new foundation for documents. Sign up now and experience limitless power to write, create, and automate anything that you can fit on a page.]\\',
    '  #text(size: 8pt, fill: luma(160))[typst.app]',
    ']',
    `- ${b}/image${b} Fills the standard image format but if you are self-hosting will upload the image to a server path so the image can persist across devices.`,
    `- While using ${b}/table${b} to create a table, pressing enter / return after the last cell in your row will create a new row in your table`,
    '',
    '== More on the Glyph Folio UI',
    '',
    '=== Main Interface',
    '- As you can see the source is on the left pane and the rendered PDF is on the right',
    '- Clicking the arrows in the top right of the panes will make them full screen. Click again to go back to side by side',
    '- You can drag the centre column to resize the panes and double click to recentre',
    '- Pressing the settings button in the top right gives you options for server connect, dictionary and source colours',
    '- Export your rendered PDF or typst source with the share button. If there are images, they will be exported together in a .glyph directory',
    '',
    '=== Explorer',
    `- Clicking the notes button or using ${b}cmd+K${b} will open the explorer`,
    '- You\'ll see the list view which give you: ',
    '    - A search box that can deep search note titles and content',
    '    - A list of your tags that you can click to filter',
    '    - A list of your most recently accessed notes in chronological order',
    '- You can then switch to graph view which will give you:',
    `    - The graph with ${b}link${b} lens on, this shows how each of your notes are connected by note links (${b}[[linked-note]]${b})`,
    `    - You can then switch to the ${b}tag${b} lens which will show how each of your notes are connected by shared tags`,
    '    - Clicking a node will take you to that note',
    `- ${b}cmd+N${b} will open a new note`,
    `- ${b}cmd+1${b} will take you back to the last note you were on so you can quickly switch back and forth between two notes`,
    `- ${b}cmd+2${b} and ${b}cmd+3${b} also work for your second and third last used notes`,
    `- ${b}cmd+R${b} will refresh the render`,
    `- ${b}cmd+F${b} Find and replace`,
    `- ${b}cmd+B${b} and ${b}cmd+I${b} when highlighting text works to wrap words in *bold* or _italics_`,
    '',
    '',
    '',
  ].join('\n')
}

export function seedDefaultNotes(): void {
  const markerPath = join(app.getPath('userData'), '.tutorial-seeded')
  if (existsSync(markerPath)) return

  const dir = resolveNotesDir()
  const date = new Date()
  const dateStr = date.toISOString().slice(0, 10)
  const dateLabel = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) +
    ' · ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

  const id = `${dateStr}-getting-started`
  const filePath = join(dir, `${id}.typ`)
  writeFileSync(filePath, makeTutorialBody(dateLabel), 'utf8')
  writeFileSync(markerPath, '', 'utf8')
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

// ── Import ───────────────────────────────────────────────────────────────────

function safeNotePath(dir: string, dateStr: string, slug: string): { id: string; filePath: string } {
  let id = `${dateStr}-${slug}`
  let filePath = join(dir, `${id}.typ`)
  let counter = 1
  while (existsSync(filePath)) {
    id = `${dateStr}-${slug}-${counter}`
    filePath = join(dir, `${id}.typ`)
    counter++
  }
  return { id, filePath }
}

function buildImportedNote(id: string, body: string, filePath: string, date: Date): Note {
  return {
    id,
    title: extractTitle(body, id),
    tags: extractTags(body),
    links: extractLinks(body),
    body,
    createdAt: date.toISOString(),
    modifiedAt: date.toISOString(),
    filePath,
  }
}

function importTyp(srcPath: string): Note {
  const body = readFileSync(srcPath, 'utf8')
  const dir = resolveNotesDir()
  const date = new Date()
  const dateStr = date.toISOString().slice(0, 10)
  const slug = basename(srcPath, '.typ').replace(/^\d{4}-\d{2}-\d{2}-/, '').slice(0, 40) || 'imported'
  const { id, filePath } = safeNotePath(dir, dateStr, slug)
  writeFileSync(filePath, body, 'utf8')
  return buildImportedNote(id, body, filePath, date)
}

function importGlyph(srcPath: string): Note | { error: string } {
  const stagingDir = join(app.getPath('temp'), `glyph-import-${Date.now()}`)
  try {
    mkdirSync(stagingDir, { recursive: true })
    if (process.platform === 'win32') {
      execFileSync('powershell', ['-NoProfile', '-Command',
        `Expand-Archive -LiteralPath '${srcPath.replace(/'/g, "''")}' -DestinationPath '${stagingDir.replace(/'/g, "''")}' -Force`
      ])
    } else {
      execFileSync('unzip', ['-o', srcPath, '-d', stagingDir])
    }

    const typEntry = readdirSync(stagingDir).find(f => f.endsWith('.typ'))
    if (!typEntry) return { error: 'No .typ file found in bundle' }

    const originalId = basename(typEntry, '.typ')
    let body = readFileSync(join(stagingDir, typEntry), 'utf8')

    const dir = resolveNotesDir()
    const date = new Date()
    const dateStr = date.toISOString().slice(0, 10)

    // Keep original ID if available; otherwise generate a collision-safe one
    let id = originalId
    if (existsSync(join(dir, `${id}.typ`))) {
      const slug = originalId.replace(/^\d{4}-\d{2}-\d{2}-/, '').slice(0, 40) || 'imported'
      id = safeNotePath(dir, dateStr, slug).id
    }

    // Update attachment refs in body if ID changed
    if (id !== originalId) {
      body = body.split(`attachments/${originalId}/`).join(`attachments/${id}/`)
    }

    // Copy attachments
    const attSrcDir = join(stagingDir, 'attachments', originalId)
    if (existsSync(attSrcDir)) {
      const attDestDir = join(dir, 'attachments', id)
      mkdirSync(attDestDir, { recursive: true })
      for (const f of readdirSync(attSrcDir)) {
        copyFileSync(join(attSrcDir, f), join(attDestDir, f))
      }
    }

    const filePath = join(dir, `${id}.typ`)
    writeFileSync(filePath, body, 'utf8')
    return buildImportedNote(id, body, filePath, date)
  } finally {
    try { rmSync(stagingDir, { recursive: true }) } catch {}
  }
}

export async function importNote(): Promise<Note | { error: string } | null> {
  const result = await dialog.showOpenDialog({
    title: 'Import note',
    filters: [{ name: 'Glyph Folio / Typst', extensions: ['glyph', 'typ'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths[0]) return null
  const srcPath = result.filePaths[0]
  try {
    return extname(srcPath).toLowerCase() === '.glyph'
      ? importGlyph(srcPath)
      : importTyp(srcPath)
  } catch (e) {
    return { error: String(e) }
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
