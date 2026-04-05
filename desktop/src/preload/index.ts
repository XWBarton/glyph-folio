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
  syncMode: 'icloud' | 'server' | 'local'
  serverUrl: string
  notesDir: string
  fontSize: number
  spellAffPath: string
  spellDicPath: string
  spellLangName: string
}

export interface FolioAPI {
  notesList(): Promise<NoteMeta[]>
  notesRead(filePath: string): Promise<Note | null>
  notesWrite(filePath: string, body: string): Promise<{ success: boolean; error?: string }>
  notesDelete(filePath: string): Promise<{ success: boolean; error?: string }>
  notesCreate(title?: string): Promise<Note>
  notesExportPdf(pdfBytes: number[], suggestedName: string): Promise<{ success: boolean; error?: string }>
  notesDir(): Promise<string>
  notesSearch(query: string): Promise<SearchResult[]>
  typstCompileNote(body: string): Promise<{ pdfBytes: number[] } | { error: string }>
  settingsGet(): Promise<AppSettings>
  settingsSet(settings: Partial<AppSettings>): Promise<void>
  syncTestServer(url: string): Promise<{ ok: boolean; error?: string }>
  onNotesChanged(cb: (event: string, filePath: string) => void): () => void
  onMenuNew(cb: () => void): () => void
  onMenuDelete(cb: () => void): () => void
  onMenuExportPdf(cb: () => void): () => void
  onMenuRerender(cb: () => void): () => void
  onFullscreenChange(cb: (isFullscreen: boolean) => void): () => void
  spellListInstalled(): Promise<{ id: string; name: string; affPath: string; dicPath: string }[]>
  spellLoadDictFiles(affPath: string, dicPath: string, langName: string): Promise<{ aff: string; dic: string; name: string } | { error: string }>
  spellPickDict(): Promise<{ aff: string; dic: string; name: string; affPath: string; dicPath: string } | { error: string } | null>
  spellLoadDict(): Promise<{ aff: string; dic: string; name: string } | null>
}

const api: FolioAPI = {
  notesList: () => ipcRenderer.invoke('notes:list'),
  notesRead: (filePath) => ipcRenderer.invoke('notes:read', filePath),
  notesWrite: (filePath, body) => ipcRenderer.invoke('notes:write', filePath, body),
  notesDelete: (filePath) => ipcRenderer.invoke('notes:delete', filePath),
  notesCreate: (title) => ipcRenderer.invoke('notes:create', title),
  notesExportPdf: (pdfBytes, name) => ipcRenderer.invoke('notes:export-pdf', pdfBytes, name),
  notesDir: () => ipcRenderer.invoke('notes:dir'),
  notesSearch: (query) => ipcRenderer.invoke('notes:search', query),
  typstCompileNote: (body) => ipcRenderer.invoke('typst:compile-note', body),
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (settings) => ipcRenderer.invoke('settings:set', settings),
  syncTestServer: (url) => ipcRenderer.invoke('sync:test-server', url),

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
  onMenuRerender: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('menu:rerender', handler)
    return () => ipcRenderer.off('menu:rerender', handler)
  },
  spellListInstalled: () => ipcRenderer.invoke('spell:list-installed'),
  spellLoadDictFiles: (affPath, dicPath, langName) => ipcRenderer.invoke('spell:load-dict-files', affPath, dicPath, langName),
  spellPickDict: () => ipcRenderer.invoke('spell:pick-dict'),
  spellLoadDict: () => ipcRenderer.invoke('spell:load-dict'),
  onFullscreenChange: (cb) => {
    const handler = (_: IpcRendererEvent, isFullscreen: boolean) => cb(isFullscreen)
    ipcRenderer.on('window:fullscreen', handler)
    return () => ipcRenderer.off('window:fullscreen', handler)
  },
}

contextBridge.exposeInMainWorld('api', api)
