import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

export interface NoteMeta {
  id: string
  title: string
  tags: string[]
  links: string[]
  createdAt: string
  modifiedAt: string
  filePath: string
}

export interface Note {
  id: string
  title: string
  tags: string[]
  links: string[]
  body: string
  createdAt: string
  modifiedAt: string
  filePath: string
}

export interface SearchResult extends NoteMeta {
  excerpt: string
  matchedIn: 'title' | 'tags' | 'body'
}

export interface AppSettings {
  syncMode: 'server' | 'local'
  serverUrl: string
  notesDir: string
  fontSize: number
  spellAffPath: string
  spellDicPath: string
  spellLangName: string
  authToken: string
  citationStyle: 'numbered' | 'author-date'
  runInBackground: boolean
  openAtLogin: boolean
  showTabs: boolean
}

export interface CompileDiagnostic {
  severity: 'error' | 'warning'
  message: string
  /** 1-based line/column in the note body, when the problem is in the note. */
  line?: number
  column?: number
  /** Set when the problem is in another file (e.g. a .bib or a package). */
  file?: string
  hints: string[]
}

export interface ReminderInfo {
  noteId: string
  noteTitle: string
  scheduledAt: string  // local ISO 8601, no zone
  fired: boolean
  overdue: boolean
}

export interface FolioAPI {
  notesList(): Promise<NoteMeta[]>
  notesRead(filePath: string): Promise<Note | null>
  notesWrite(filePath: string, body: string): Promise<{ success: boolean; error?: string }>
  notesUpsert(id: string, body: string, mtime?: string): Promise<{ success: boolean; error?: string }>
  notesDelete(filePath: string): Promise<{ success: boolean; error?: string }>
  notesCreate(title?: string): Promise<Note>
  notesExportPdf(pdfBytes: number[], suggestedName: string): Promise<{ success: boolean; error?: string }>
  notesExportDocx(filePath: string, suggestedName: string): Promise<{ success: boolean; error?: string }>
  notesDir(): Promise<string>
  menuPopup(): Promise<void>
  notesSearch(query: string): Promise<SearchResult[]>
  notesRenameLinks(oldTitle: string, newTitle: string, excludeFilePath: string): Promise<string[]>
  bibList(): Promise<string[]>
  typstCompileNote(body: string): Promise<{ pdfBytes: Uint8Array } | { error: string; diagnostics?: CompileDiagnostic[] }>
  typstCompileNoteForExport(body: string): Promise<{ pdfBytes: Uint8Array } | { error: string }>
  attachmentsList(noteId: string): Promise<string[]>
  attachmentsPickAndSave(noteId: string): Promise<{ filename: string } | null>
  attachmentsSaveFile(noteId: string, srcPath: string): Promise<{ filename: string } | { error: string }>
  attachmentsRead(noteId: string, filename: string): Promise<{ dataBase64: string } | null>
  attachmentsWrite(noteId: string, filename: string, dataBase64: string): Promise<{ ok: boolean } | { error: string }>
  attachmentsDelete(noteId: string, filename: string): Promise<{ ok: boolean } | { error: string }>
  notesShareSource(noteId: string, filePath: string): Promise<{ ok: boolean; error?: string }>
  notesImport(): Promise<Note | { error: string } | null>
  settingsGet(): Promise<AppSettings>
  settingsSet(settings: Partial<AppSettings>): Promise<void>
  syncTestServer(url: string, token?: string): Promise<{ ok: boolean; error?: string }>
  onNotesChanged(cb: (event: string, filePath: string) => void): () => void
  onMenuNew(cb: () => void): () => void
  onMenuDelete(cb: () => void): () => void
  onMenuExportPdf(cb: () => void): () => void
  onMenuExportDocx(cb: () => void): () => void
  onMenuShareSource(cb: () => void): () => void
  onMenuImport(cb: () => void): () => void
  onMenuRerender(cb: () => void): () => void
  onMenuReminders(cb: () => void): () => void
  onMenuDictionary(cb: () => void): () => void
  onFullscreenChange(cb: (isFullscreen: boolean) => void): () => void
  onMenuCloseTab(cb: () => void): () => void
  onSettingsChanged(cb: (settings: AppSettings) => void): () => void
  windowOpenNote(noteId?: string): Promise<void>
  windowClose(): Promise<void>
  syncGetBase(noteId: string): Promise<string | null>
  syncSetBase(noteId: string, body: string): Promise<void>
  spellListInstalled(): Promise<{ id: string; name: string; affPath: string; dicPath: string }[]>
  spellLoadDictFiles(affPath: string, dicPath: string, langName: string): Promise<{ aff: string; dic: string; name: string } | { error: string }>
  spellPickDict(): Promise<{ aff: string; dic: string; name: string; affPath: string; dicPath: string } | { error: string } | null>
  spellLoadDict(): Promise<{ aff: string; dic: string; name: string } | null>
  reminderList(): Promise<ReminderInfo[]>
  reminderUpdateNote(noteId: string, isoDate: string | null): Promise<{ success: boolean; error?: string }>
  reminderTest(): Promise<{ supported: boolean; shown: boolean; error?: string }>
  onRemindersChanged(cb: () => void): () => void
  onReminderOpen(cb: (noteId: string) => void): () => void
}

const api: FolioAPI = {
  notesList: () => ipcRenderer.invoke('notes:list'),
  notesRead: (filePath) => ipcRenderer.invoke('notes:read', filePath),
  notesWrite: (filePath, body) => ipcRenderer.invoke('notes:write', filePath, body),
  notesUpsert: (id, body, mtime) => ipcRenderer.invoke('notes:upsert', id, body, mtime),
  notesDelete: (filePath) => ipcRenderer.invoke('notes:delete', filePath),
  notesCreate: (title) => ipcRenderer.invoke('notes:create', title),
  notesExportPdf: (pdfBytes, name) => ipcRenderer.invoke('notes:export-pdf', pdfBytes, name),
  notesExportDocx: (filePath, name) => ipcRenderer.invoke('notes:export-docx', filePath, name),
  notesDir: () => ipcRenderer.invoke('notes:dir'),
  menuPopup: () => ipcRenderer.invoke('menu:popup'),
  notesSearch: (query) => ipcRenderer.invoke('notes:search', query),
  notesRenameLinks: (oldTitle, newTitle, excludeFilePath) => ipcRenderer.invoke('notes:rename-links', oldTitle, newTitle, excludeFilePath),
  bibList: () => ipcRenderer.invoke('bib:list'),
  typstCompileNote: (body) => ipcRenderer.invoke('typst:compile-note', body),
  typstCompileNoteForExport: (body) => ipcRenderer.invoke('typst:compile-note-for-export', body),
  attachmentsList: (noteId) => ipcRenderer.invoke('attachments:list', noteId),
  attachmentsPickAndSave: (noteId) => ipcRenderer.invoke('attachments:pick-and-save', noteId),
  attachmentsSaveFile: (noteId, srcPath) => ipcRenderer.invoke('attachments:save-file', noteId, srcPath),
  attachmentsRead: (noteId, filename) => ipcRenderer.invoke('attachments:read', noteId, filename),
  attachmentsWrite: (noteId, filename, dataBase64) => ipcRenderer.invoke('attachments:write', noteId, filename, dataBase64),
  attachmentsDelete: (noteId, filename) => ipcRenderer.invoke('attachments:delete', noteId, filename),
  notesShareSource: (noteId, filePath) => ipcRenderer.invoke('notes:share-source', noteId, filePath),
  notesImport: () => ipcRenderer.invoke('notes:import'),
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (settings) => ipcRenderer.invoke('settings:set', settings),
  syncTestServer: (url, token) => ipcRenderer.invoke('sync:test-server', url, token),

  onNotesChanged: (cb) => {
    const handler = (_: IpcRendererEvent, event: string, filePath: string) => cb(event, filePath)
    ipcRenderer.on('notes:changed', handler)
    return () => ipcRenderer.off('notes:changed', handler)
  },
  onMenuNew: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('menu:new', handler)
    return () => ipcRenderer.off('menu:new', handler)
  },
  onMenuDelete: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('menu:delete', handler)
    return () => ipcRenderer.off('menu:delete', handler)
  },
  onMenuExportPdf: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('menu:export-pdf', handler)
    return () => ipcRenderer.off('menu:export-pdf', handler)
  },
  onMenuExportDocx: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('menu:export-docx', handler)
    return () => ipcRenderer.off('menu:export-docx', handler)
  },
  onMenuRerender: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('menu:rerender', handler)
    return () => ipcRenderer.off('menu:rerender', handler)
  },
  onMenuShareSource: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('menu:share-source', handler)
    return () => ipcRenderer.off('menu:share-source', handler)
  },
  onMenuImport: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('menu:import', handler)
    return () => ipcRenderer.off('menu:import', handler)
  },
  syncGetBase: (noteId) => ipcRenderer.invoke('sync:get-base', noteId),
  syncSetBase: (noteId, body) => ipcRenderer.invoke('sync:set-base', noteId, body),
  spellListInstalled: () => ipcRenderer.invoke('spell:list-installed'),
  spellLoadDictFiles: (affPath, dicPath, langName) => ipcRenderer.invoke('spell:load-dict-files', affPath, dicPath, langName),
  spellPickDict: () => ipcRenderer.invoke('spell:pick-dict'),
  spellLoadDict: () => ipcRenderer.invoke('spell:load-dict'),
  reminderList: () => ipcRenderer.invoke('reminder:list'),
  reminderUpdateNote: (noteId, isoDate) => ipcRenderer.invoke('reminder:update-note', noteId, isoDate),
  reminderTest: () => ipcRenderer.invoke('reminder:test'),
  onRemindersChanged: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('reminders:changed', handler)
    return () => ipcRenderer.off('reminders:changed', handler)
  },
  onReminderOpen: (cb) => {
    const handler = (_: IpcRendererEvent, noteId: string) => cb(noteId)
    ipcRenderer.on('reminder:open', handler)
    return () => ipcRenderer.off('reminder:open', handler)
  },
  onMenuDictionary: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('menu:dictionary', handler)
    return () => ipcRenderer.off('menu:dictionary', handler)
  },
  onMenuReminders: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('menu:reminders', handler)
    return () => ipcRenderer.off('menu:reminders', handler)
  },
  onMenuCloseTab: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('menu:close-tab', handler)
    return () => ipcRenderer.off('menu:close-tab', handler)
  },
  onSettingsChanged: (cb) => {
    const handler = (_: IpcRendererEvent, settings: AppSettings) => cb(settings)
    ipcRenderer.on('settings:changed', handler)
    return () => ipcRenderer.off('settings:changed', handler)
  },
  windowOpenNote: (noteId) => ipcRenderer.invoke('window:open-note', noteId),
  windowClose: () => ipcRenderer.invoke('window:close'),
  onFullscreenChange: (cb) => {
    const handler = (_: IpcRendererEvent, isFullscreen: boolean) => cb(isFullscreen)
    ipcRenderer.on('window:fullscreen', handler)
    return () => ipcRenderer.off('window:fullscreen', handler)
  },
}

contextBridge.exposeInMainWorld('api', api)
