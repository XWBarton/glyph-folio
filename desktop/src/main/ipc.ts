import { ipcMain, dialog } from 'electron'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { basename, join, dirname } from 'path'
import { compileNote } from './compiler'
import {
  listNotes, readNote, writeNote, deleteNote, createNote, exportNotePdf, resolveNotesDir, searchNotes
} from './notesManager'
import { getStore } from './store'
import { net } from 'electron'

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

  ipcMain.handle('sync:test-server', async (_event, url: string) => {
    try {
      const healthUrl = url.replace(/\/$/, '') + '/api/health'
      const response = await net.fetch(healthUrl, { method: 'GET' })
      if (response.ok) return { ok: true }
      return { ok: false, error: `Server returned ${response.status}` }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
}
