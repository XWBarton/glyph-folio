import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

export interface AppSettings {
  syncMode: 'icloud' | 'server' | 'local'
  serverUrl: string
  notesDir: string
  fontSize: number
  spellAffPath: string
  spellDicPath: string
  spellLangName: string
  authToken: string
}

const DEFAULTS: AppSettings = {
  syncMode: 'local',
  serverUrl: '',
  notesDir: '',
  fontSize: 14,
  spellAffPath: '',
  spellDicPath: '',
  spellLangName: '',
  authToken: '',
}

// Simple JSON-based store (no external dependency required)
class SimpleStore {
  private path: string
  private data: AppSettings

  constructor() {
    const userDataDir = app.getPath('userData')
    mkdirSync(userDataDir, { recursive: true })
    this.path = join(userDataDir, 'settings.json')
    this.data = this.load()
  }

  private load(): AppSettings {
    try {
      if (existsSync(this.path)) {
        return { ...DEFAULTS, ...JSON.parse(readFileSync(this.path, 'utf8')) }
      }
    } catch {}
    return { ...DEFAULTS }
  }

  private save(): void {
    try { writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf8') } catch {}
  }

  get<K extends keyof AppSettings>(key: K, defaultValue?: AppSettings[K]): AppSettings[K] {
    return this.data[key] ?? defaultValue ?? DEFAULTS[key]
  }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.data[key] = value
    this.save()
  }

  getAll(): AppSettings {
    return { ...this.data }
  }

  setAll(settings: Partial<AppSettings>): void {
    this.data = { ...this.data, ...settings }
    this.save()
  }
}

let _store: SimpleStore | null = null

export function getStore(): SimpleStore {
  if (!_store) _store = new SimpleStore()
  return _store
}
