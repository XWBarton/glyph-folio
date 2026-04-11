import { useState, useCallback, useRef } from 'react'
import { merge3 } from '../lib/merge3'

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'idle'

function normalizeUrl(url: string): string {
  if (!url) return url
  // Upgrade http:// to https:// for non-local addresses (Cloudflare tunnels require HTTPS)
  if (url.startsWith('http://')) {
    const host = url.slice(7).split('/')[0].split(':')[0]
    const isLocal = host === 'localhost' || host === '127.0.0.1' ||
      /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    if (!isLocal) return 'https://' + url.slice(7)
  }
  return url
}

export function useServerSync(serverUrl: string, enabled: boolean, authToken?: string) {
  const [status, setStatus] = useState<SyncStatus>('idle')
  const queueRef = useRef<Map<string, string>>(new Map())
  const flushingRef = useRef(false)
  const base = normalizeUrl(serverUrl).replace(/\/$/, '')

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
          await fetch(`${base}/api/notes/${encodeURIComponent(noteId)}`, {
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
      const res = await fetch(`${base}/api/compile`, {
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
            await window.api.notesUpsert(remote.id, remote.body, sn.modifiedAt)
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
              // No local changes — safe to overwrite, restore server mtime to keep chronology stable
              await window.api.notesUpsert(sn.id, remote.body, sn.modifiedAt)
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

      // Sync attachments for all notes present on both sides
      const allIds = [...new Set([...serverNotes.map(n => n.id), ...localNotes.map(n => n.id)])]
      await Promise.all(allIds.map(async (noteId) => {
        try {
          const [serverRes, localFiles] = await Promise.all([
            fetch(`${base}/api/notes/${encodeURIComponent(noteId)}/attachments`, { headers }),
            window.api.attachmentsList(noteId),
          ])
          if (!serverRes.ok) return
          const serverFiles: { filename: string }[] = await serverRes.json()
          const serverSet = new Set(serverFiles.map(f => f.filename))
          const localSet  = new Set(localFiles)

          await Promise.all([
            ...serverFiles.filter(f => !localSet.has(f.filename)).map(async ({ filename }) => {
              try {
                const r = await fetch(`${base}/api/notes/${encodeURIComponent(noteId)}/attachments/${encodeURIComponent(filename)}`, { headers })
                if (!r.ok) return
                const buf = await r.arrayBuffer()
                const b64 = arrayBufferToBase64(buf)
                await window.api.attachmentsWrite(noteId, filename, b64)
              } catch {}
            }),
            ...localFiles.filter(f => !serverSet.has(f)).map(async (filename) => {
              const att = await window.api.attachmentsRead(noteId, filename)
              if (!att) return
              try {
                await fetch(`${base}/api/notes/${encodeURIComponent(noteId)}/attachments`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...headers },
                  body: JSON.stringify({ filename, dataBase64: att.dataBase64 })
                })
              } catch {}
            }),
          ])
        } catch {}
      }))

      setStatus('synced')
      return 'synced'
    } catch {
      setStatus('offline')
      return 'offline'
    }
  }, [enabled, serverUrl, authToken])

  const deleteNote = useCallback(async (id: string) => {
    if (!enabled || !serverUrl) return
    try {
      await fetch(`${base}/api/notes/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {},
      })
    } catch { /* offline — note is already gone locally, that's fine */ }
  }, [enabled, serverUrl, authToken])

  /** Upload a locally-saved attachment to the server. Call after attachmentsSaveFile/attachmentsWrite. */
  const uploadAttachment = useCallback(async (noteId: string, filename: string) => {
    if (!enabled || !serverUrl) return
    const att = await window.api.attachmentsRead(noteId, filename)
    if (!att) return
    try {
      await fetch(`${base}/api/notes/${encodeURIComponent(noteId)}/attachments`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ filename, dataBase64: att.dataBase64 })
      })
    } catch { /* offline */ }
  }, [enabled, serverUrl, authToken])

  /** Sync attachments for all notes: download server-only, upload local-only. */
  const syncAttachments = useCallback(async (noteIds: string[]) => {
    if (!enabled || !serverUrl) return
    const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
    await Promise.all(noteIds.map(async (noteId) => {
      try {
        const [serverRes, localFiles] = await Promise.all([
          fetch(`${base}/api/notes/${encodeURIComponent(noteId)}/attachments`, { headers }),
          window.api.attachmentsList(noteId),
        ])
        if (!serverRes.ok) return
        const serverFiles: { filename: string }[] = await serverRes.json()
        const serverSet = new Set(serverFiles.map(f => f.filename))
        const localSet  = new Set(localFiles)

        // Download server-only attachments
        await Promise.all(
          serverFiles
            .filter(f => !localSet.has(f.filename))
            .map(async ({ filename }) => {
              try {
                const r = await fetch(
                  `${base}/api/notes/${encodeURIComponent(noteId)}/attachments/${encodeURIComponent(filename)}`,
                  { headers }
                )
                if (!r.ok) return
                const buf = await r.arrayBuffer()
                const b64 = arrayBufferToBase64(buf)
                await window.api.attachmentsWrite(noteId, filename, b64)
              } catch {}
            })
        )

        // Upload local-only attachments
        await Promise.all(
          localFiles
            .filter(f => !serverSet.has(f))
            .map(async (filename) => {
              const att = await window.api.attachmentsRead(noteId, filename)
              if (!att) return
              try {
                await fetch(`${base}/api/notes/${encodeURIComponent(noteId)}/attachments`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...headers },
                  body: JSON.stringify({ filename, dataBase64: att.dataBase64 })
                })
              } catch {}
            })
        )
      } catch {}
    }))
  }, [enabled, serverUrl, authToken])

  return { status, pushNote, compilePdf, syncAll, deleteNote, uploadAttachment, syncAttachments }
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
