import { useState, useCallback, useRef } from 'react'

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'idle'

export function useServerSync(serverUrl: string, enabled: boolean) {
  const [status, setStatus] = useState<SyncStatus>('idle')
  const queueRef = useRef<Map<string, string>>(new Map())
  const flushingRef = useRef(false)

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
        await Promise.all(entries.map(([noteId, noteBody]) =>
          fetch(`${serverUrl.replace(/\/$/, '')}/api/notes/${encodeURIComponent(noteId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: noteBody })
          })
        ))
        setStatus('synced')
      } catch {
        // Re-queue failed entries
        for (const [noteId, noteBody] of entries) {
          queueRef.current.set(noteId, noteBody)
        }
        setStatus('offline')
        break
      }
    }
    flushingRef.current = false
  }, [enabled, serverUrl])

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

  return { status, pushNote, compilePdf }
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
