import express from 'express'
import cors from 'cors'
import { authMiddleware } from './auth'
import { listNotes, readNote, writeNote, deleteNote, ensureNotesDir } from './storage'
import { compileTypst } from './compiler'

const app = express()
const PORT = Number(process.env['PORT'] ?? 3001)

app.use(cors())
app.use(express.json({ limit: '4mb' }))
app.use(authMiddleware)

ensureNotesDir()

// ── Health ───────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: '0.1.0' })
})

// ── Notes CRUD ────────────────────────────────────────────────────────────────

app.get('/api/notes', (_req, res) => {
  res.json(listNotes())
})

app.get('/api/notes/:id', (req, res) => {
  const note = readNote(req.params['id']!)
  if (!note) { res.status(404).json({ error: 'Not found' }); return }
  res.json(note)
})

app.put('/api/notes/:id', (req, res) => {
  const { body } = req.body as { body?: string }
  if (typeof body !== 'string') { res.status(400).json({ error: 'body required' }); return }
  try {
    writeNote(req.params['id']!, body)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.delete('/api/notes/:id', (req, res) => {
  try {
    deleteNote(req.params['id']!)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ── Compile ───────────────────────────────────────────────────────────────────

app.post('/api/compile', async (req, res) => {
  const { content } = req.body as { content?: string }
  if (typeof content !== 'string') { res.status(400).json({ error: 'content required' }); return }

  const result = await compileTypst(content)
  res.json(result)
})

// ── Export: compile + stream PDF ──────────────────────────────────────────────

app.post('/api/notes/:id/export', async (req, res) => {
  const note = readNote(req.params['id']!)
  if (!note) { res.status(404).json({ error: 'Not found' }); return }

  const { title = note.title, date = new Date(note.modifiedAt).toLocaleDateString() } =
    req.body as { title?: string; date?: string }

  const safeTitle = title.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]')
  const content = `#set page(margin: 2cm)
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

${note.body}
`

  const result = await compileTypst(content)
  if (!result.ok) { res.status(500).json({ error: result.error }); return }

  const buf = Buffer.from(result.pdfBase64, 'base64')
  res.set('Content-Type', 'application/pdf')
  res.set('Content-Disposition', `attachment; filename="${note.id}.pdf"`)
  res.send(buf)
})

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Glyph Folio server running on http://localhost:${PORT}`)
  console.log(`Notes stored in: ${process.cwd()}/data/notes/`)
  if (!process.env['AUTH_TOKEN']) {
    console.log('Auth: disabled (set AUTH_TOKEN env var to enable)')
  }
})
