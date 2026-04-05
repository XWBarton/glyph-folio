/**
 * Stores the "base" body for each note — the body at the time of the last
 * successful sync. This is used as the common ancestor for 3-way merges.
 */
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

function getPath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'sync-bases.json')
}

function load(): Record<string, string> {
  try {
    const p = getPath()
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'))
  } catch {}
  return {}
}

function save(data: Record<string, string>): void {
  try { writeFileSync(getPath(), JSON.stringify(data), 'utf8') } catch {}
}

export function getBase(noteId: string): string | null {
  return load()[noteId] ?? null
}

export function setBase(noteId: string, body: string): void {
  const data = load()
  data[noteId] = body
  save(data)
}

export function clearBase(noteId: string): void {
  const data = load()
  delete data[noteId]
  save(data)
}
