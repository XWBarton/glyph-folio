import { ipcMain, dialog } from 'electron'
import { getBase, setBase } from './syncBase'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { basename, join, dirname } from 'path'
import { execFileSync } from 'child_process'
import { compileNote } from './compiler'
import {
  listNotes, readNote, writeNote, upsertNote, deleteNote, createNote, exportNotePdf, resolveNotesDir, searchNotes,
  listAttachments, readAttachmentBuffer, writeAttachmentBuffer, deleteAttachmentFile,
  pickAndSaveAttachment, saveFileAsAttachment, renameWikiLinks
} from './notesManager'
import { getStore } from './store'
import { net } from 'electron'

/** Upload an attachment to the sync server (fire-and-forget; only runs in server mode). */
async function uploadAttachmentToServer(noteId: string, filename: string, buf: Buffer): Promise<void> {
  const store = getStore()
  if (store.get('syncMode') !== 'server') return
  const serverUrl = store.get('serverUrl').replace(/\/$/, '')
  if (!serverUrl) return
  const authToken = store.get('authToken')

  const url = `${serverUrl}/api/notes/${encodeURIComponent(noteId)}/attachments`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`

  try {
    await net.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ filename, dataBase64: buf.toString('base64') }),
    })
  } catch (e) {
    console.error('Failed to upload attachment to server:', e)
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('notes:list', async () => {
    return listNotes()
  })

  ipcMain.handle('notes:read', async (_event, filePath: string) => {
    return readNote(filePath)
  })

  ipcMain.handle('notes:write', async (_event, filePath: string, body: string) => {
    return writeNote(filePath, body)
  })

  ipcMain.handle('notes:upsert', async (_event, id: string, body: string) => {
    return upsertNote(id, body)
  })

  ipcMain.handle('sync:get-base', (_event, noteId: string) => getBase(noteId))
  ipcMain.handle('sync:set-base', (_event, noteId: string, body: string) => setBase(noteId, body))

  ipcMain.handle('notes:delete', async (_event, filePath: string) => {
    return deleteNote(filePath)
  })

  ipcMain.handle('notes:create', async (_event, title?: string) => {
    return createNote(title)
  })

  ipcMain.handle('notes:export-pdf', async (_event, pdfBytes: number[], suggestedName: string) => {
    return exportNotePdf(pdfBytes, suggestedName)
  })

  ipcMain.handle('notes:dir', async () => {
    return resolveNotesDir()
  })

  ipcMain.handle('notes:search', async (_event, query: string) => {
    return searchNotes(query)
  })

  ipcMain.handle('notes:rename-links', (_event, oldTitle: string, newTitle: string, excludeFilePath: string) => {
    return renameWikiLinks(oldTitle, newTitle, excludeFilePath)
  })

  ipcMain.handle('typst:compile-note', async (_event, body: string) => {
    const result = await compileNote(body)
    if ('pdfBytes' in result) {
      return { pdfBytes: Array.from(result.pdfBytes) }
    }
    return result
  })

  ipcMain.handle('settings:get', async () => {
    return getStore().getAll()
  })

  ipcMain.handle('settings:set', async (_event, settings: Record<string, unknown>) => {
    getStore().setAll(settings as Partial<import('./store').AppSettings>)
  })

  // Scan node_modules for installed dictionary-* packages
  ipcMain.handle('spell:list-installed', async () => {
    const { app } = await import('electron')
    const candidates = [
      join(dirname(app.getAppPath()), 'node_modules'),
      join(app.getAppPath(), 'node_modules'),
      join(process.cwd(), 'node_modules'),
    ]
    const nmDir = candidates.find(existsSync) ?? ''
    if (!nmDir) return []

    let entries: string[] = []
    try { entries = readdirSync(nmDir) } catch { return [] }

    const dicts: { id: string; name: string; affPath: string; dicPath: string }[] = []
    for (const entry of entries) {
      if (!entry.startsWith('dictionary-')) continue
      const affPath = join(nmDir, entry, 'index.aff')
      const dicPath = join(nmDir, entry, 'index.dic')
      if (existsSync(affPath) && existsSync(dicPath)) {
        const id = entry.replace('dictionary-', '')
        const name = id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        dicts.push({ id, name, affPath, dicPath })
      }
    }
    return dicts
  })

  // Load a dictionary-* package by its affPath/dicPath
  ipcMain.handle('spell:load-dict-files', async (_event, affPath: string, dicPath: string, langName: string) => {
    try {
      const aff = readFileSync(affPath, 'utf8')
      const dic = readFileSync(dicPath, 'utf8')
      return { aff, dic, name: langName }
    } catch (e) {
      return { error: String(e) }
    }
  })

  // Pick a Hunspell .aff file — auto-finds matching .dic in same folder
  ipcMain.handle('spell:pick-dict', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose dictionary .aff file',
      filters: [{ name: 'Hunspell AFF', extensions: ['aff'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const affPath = result.filePaths[0]
    const dicPath = join(dirname(affPath), basename(affPath, '.aff') + '.dic')
    if (!existsSync(dicPath)) return { error: `Could not find matching .dic file at ${dicPath}` }
    try {
      const aff = readFileSync(affPath, 'utf8')
      const dic = readFileSync(dicPath, 'utf8')
      const name = basename(affPath, '.aff')
      return { aff, dic, name, affPath, dicPath }
    } catch (e) {
      return { error: String(e) }
    }
  })

  // Read previously saved dict paths on startup
  ipcMain.handle('spell:load-dict', async () => {
    const store = getStore()
    const affPath = store.get('spellAffPath')
    const dicPath = store.get('spellDicPath')
    if (!affPath || !dicPath || !existsSync(affPath) || !existsSync(dicPath)) return null
    try {
      const aff = readFileSync(affPath, 'utf8')
      const dic = readFileSync(dicPath, 'utf8')
      const name = store.get('spellLangName') || basename(affPath, '.aff')
      return { aff, dic, name, affPath, dicPath }
    } catch {
      return null
    }
  })

  // ── Attachments ────────────────────────────────────────────────────────────

  ipcMain.handle('attachments:list', async (_event, noteId: string) => {
    return listAttachments(noteId)
  })

  ipcMain.handle('attachments:pick-and-save', async (_event, noteId: string) => {
    const result = await pickAndSaveAttachment(noteId)
    if (result) {
      const buf = readAttachmentBuffer(noteId, result.filename)
      if (buf) uploadAttachmentToServer(noteId, result.filename, buf)
    }
    return result
  })

  ipcMain.handle('attachments:save-file', async (_event, noteId: string, srcPath: string) => {
    try {
      const result = saveFileAsAttachment(noteId, srcPath)
      const buf = readAttachmentBuffer(noteId, result.filename)
      if (buf) uploadAttachmentToServer(noteId, result.filename, buf)
      return result
    } catch (e) {
      return { error: String(e) }
    }
  })

  ipcMain.handle('attachments:read', async (_event, noteId: string, filename: string) => {
    const buf = readAttachmentBuffer(noteId, filename)
    if (!buf) return null
    return { dataBase64: buf.toString('base64') }
  })

  ipcMain.handle('attachments:write', async (_event, noteId: string, filename: string, dataBase64: string) => {
    try {
      writeAttachmentBuffer(noteId, filename, Buffer.from(dataBase64, 'base64'))
      return { ok: true }
    } catch (e) {
      return { error: String(e) }
    }
  })

  ipcMain.handle('attachments:delete', async (_event, noteId: string, filename: string) => {
    try { deleteAttachmentFile(noteId, filename); return { ok: true } }
    catch (e) { return { error: String(e) } }
  })

  // ── Share source (.typ or .glyph bundle) ───────────────────────────────────

  ipcMain.handle('notes:share-source', async (_event, noteId: string, filePath: string) => {
    const attachments = listAttachments(noteId)
    const hasAttachments = attachments.length > 0

    if (!hasAttachments) {
      // No attachments — just save a copy of the .typ file
      const result = await dialog.showSaveDialog({
        defaultPath: `${noteId}.typ`,
        filters: [{ name: 'Typst document', extensions: ['typ'] }],
      })
      if (result.canceled || !result.filePath) return { ok: false }
      try {
        const body = readFileSync(filePath, 'utf8')
        writeFileSync(result.filePath, body, 'utf8')
        return { ok: true }
      } catch (e) {
        return { ok: false, error: String(e) }
      }
    }

    // Has attachments — build a .glyph zip bundle
    const result = await dialog.showSaveDialog({
      defaultPath: `${noteId}.glyph`,
      filters: [{ name: 'Glyph Folio bundle', extensions: ['glyph'] }],
    })
    if (result.canceled || !result.filePath) return { ok: false }

    try {
      const { app } = await import('electron')
      const { mkdirSync, copyFileSync, rmSync } = await import('fs')
      const stagingDir = join(app.getPath('temp'), `glyph-share-${noteId}`)
      const notesDir = resolveNotesDir()

      // Stage .typ
      mkdirSync(stagingDir, { recursive: true })
      copyFileSync(filePath, join(stagingDir, `${noteId}.typ`))

      // Stage attachments preserving directory structure
      const attStagingDir = join(stagingDir, 'attachments', noteId)
      mkdirSync(attStagingDir, { recursive: true })
      for (const att of attachments) {
        copyFileSync(join(notesDir, 'attachments', noteId, att), join(attStagingDir, att))
      }

      // Zip from staging dir so paths inside zip are relative
      if (process.platform === 'win32') {
        execFileSync('powershell', ['-Command',
          `Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${result.filePath}' -Force`
        ])
      } else {
        execFileSync('sh', ['-c',
          `cd '${stagingDir.replace(/'/g, "'\\''")}' && zip -r '${result.filePath.replace(/'/g, "'\\''")}' .`
        ])
      }

      try { rmSync(stagingDir, { recursive: true }) } catch {}
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle('sync:test-server', async (_event, url: string, token?: string) => {
    try {
      const healthUrl = url.replace(/\/$/, '') + '/api/health'
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      const response = await net.fetch(healthUrl, { method: 'GET', headers })
      if (response.ok) return { ok: true }
      return { ok: false, error: `Server returned ${response.status}` }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
}
