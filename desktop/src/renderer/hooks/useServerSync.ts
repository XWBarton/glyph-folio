import { useState, useCallback, useRef } from 'react'
import { merge3 } from '../lib/merge3'

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'idle'

export function useServerSync(serverUrl: string, enabled: boolean, authToken?: string) {
  const [status, setStatus] = useState<SyncStatus>('idle')
  const queueRef = useRef<Map<string, string>>(new Map())
  const flushingRef = useRef(false)

  const authHeaders = (extra?: Record<string, string>) => ({
    'Content-Type': 'application/json',
    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
    ...extra,
  })

  const pushNote = useCallback(async (id: string, body: string) => {
    if (!enabled || !serverUrl) return
    queueRef.current.set(id, body)
    if (flushingRef.current) return

    flushingRef.current = true
    setStatus('syncing')

    while (queueRef.current.size > 0) {
      const entries = Array.from(queueRef.current.entries())
      queueRef.current.clear()
      try {
        await Promise.all(entries.map(async ([noteId, noteBody]) => {
          await fetch(`${serverUrl.replace(/\/$/, '')}/api/notes/${encodeURIComponent(noteId)}`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ body: noteBody })
          })
          await window.api.syncSetBase(noteId, noteBody)
        }))
        setStatus('synced')
      } catch {
        for (const [noteId, noteBody] of entries) {
          queueRef.current.set(noteId, noteBody)
        }
        setStatus('offline')
        break
      }
    }
    flushingRef.current = false
  }, [enabled, serverUrl, authToken])

  const compilePdf = useCallback(async (
    id: string,
    body: string,
    title: string,
    date: string
  ): Promise<{ pdfBytes: number[] } | { error: string }> => {
    if (!enabled || !serverUrl) {
      return { error: 'Server sync not enabled' }
    }
    try {
      const content = buildTemplate(body, title, date)
      const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, noteId: id })
      })
      const data = await res.json() as { ok: boolean; pdfBase64?: string; error?: string }
      if (data.ok && data.pdfBase64) {
        const binary = atob(data.pdfBase64)
        const bytes = new Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        return { pdfBytes: bytes }
      }
      return { error: data.error ?? 'Compilation failed' }
    } catch (e) {
      return { error: String(e) }
    }
  }, [enabled, serverUrl])

  const syncAll = useCallback(async (): Promise<'synced' | 'offline'> => {
    if (!enabled || !serverUrl) return 'offline'
    const base = serverUrl.replace(/\/$/, '')
    const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {}

    setStatus('syncing')
    try {
      // 1. Fetch server note list + local note list in parallel
      const [serverRes, localNotes] = await Promise.all([
        fetch(`${base}/api/notes`, { headers }),
        window.api.notesList(),
      ])
      if (!serverRes.ok) { setStatus('offline'); return 'offline' }

      const serverNotes = await serverRes.json() as { id: string; modifiedAt: string }[]
      const serverMap   = new Map(serverNotes.map(n => [n.id, n]))
      const localMap    = new Map(localNotes.map(n => [n.id, n]))

      const tasks: Promise<void>[] = []

      // 2. Handle notes that exist on server
      for (const sn of serverNotes) {
        const ln = localMap.get(sn.id)

        if (!ln) {
          // Only on server — download it
          tasks.push((async () => {
            const r = await fetch(`${base}/api/notes/${encodeURIComponent(sn.id)}`, { headers })
            if (!r.ok) return
            const remote = await r.json() as { id: string; body: string }
            await window.api.notesUpsert(remote.id, remote.body)
            await window.api.syncSetBase(sn.id, remote.body)
          })())
          continue
        }

        const serverNewer = new Date(sn.modifiedAt) > new Date(ln.modifiedAt)
        const localNewer  = new Date(ln.modifiedAt) > new Date(sn.modifiedAt)

        if (serverNewer) {
          tasks.push((async () => {
            const r = await fetch(`${base}/api/notes/${encodeURIComponent(sn.id)}`, { headers })
            if (!r.ok) return
            const remote = await r.json() as { id: string; body: string }

            // Check if local also changed since last sync → conflict
            const syncBase = await window.api.syncGetBase(sn.id)
            const localNote = await window.api.notesRead(ln.filePath)
            if (!localNote) return

            const localChanged = syncBase !== null && localNote.body !== syncBase
            if (localChanged && syncBase !== null) {
              // 3-way merge
              const { merged, hasConflicts } = merge3(syncBase, localNote.body, remote.body)
              await window.api.notesUpsert(sn.id, merged)
              // Push merged result back to server
              await fetch(`${base}/api/notes/${encodeURIComponent(sn.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ body: merged }),
              })
              await window.api.syncSetBase(sn.id, merged)
              if (hasConflicts) console.warn(`[sync] Conflict markers inserted in: ${sn.id}`)
            } else {
              // No local changes — safe to overwrite
              await window.api.notesUpsert(sn.id, remote.body)
              await window.api.syncSetBase(sn.id, remote.body)
            }
          })())
        } else if (localNewer) {
          tasks.push((async () => {
            const localNote = await window.api.notesRead(ln.filePath)
            if (!localNote) return
            await fetch(`${base}/api/notes/${encodeURIComponent(ln.id)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', ...headers },
              body: JSON.stringify({ body: localNote.body }),
            })
            await window.api.syncSetBase(ln.id, localNote.body)
          })())
        }
        // If timestamps are equal — already in sync, nothing to do
      }

      // 3. Handle notes that only exist locally — upload them
      for (const ln of localNotes) {
        if (!serverMap.has(ln.id)) {
          tasks.push((async () => {
            const localNote = await window.api.notesRead(ln.filePath)
            if (!localNote) return
            await fetch(`${base}/api/notes/${encodeURIComponent(ln.id)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', ...headers },
              body: JSON.stringify({ body: localNote.body }),
            })
            await window.api.syncSetBase(ln.id, localNote.body)
          })())
        }
      }

      await Promise.all(tasks)
      setStatus('synced')
      return 'synced'
    } catch {
      setStatus('offline')
      return 'offline'
    }
  }, [enabled, serverUrl, authToken])

  return { status, pushNote, compilePdf, syncAll }
}

function buildTemplate(body: string, title: string, date: string): string {
  const safeTitle = title.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]')
  return `#set page(margin: 2cm)
#set text(font: "New Computer Modern", size: 11pt)
#set heading(numbering: none)

#align(center)[
  #text(size: 18pt, weight: "bold")[${safeTitle}]
  #v(0.4em)
  #text(size: 10pt, fill: gray)[${date}]
]

#v(0.8em)
#line(length: 100%, stroke: 0.5pt + gray)
#v(0.8em)

${body}
`
}
