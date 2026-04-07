import React, { useEffect, useRef, useState, useCallback } from 'react'
import type { NoteMeta } from '../hooks/useNotes'

interface Props {
  notes: NoteMeta[]
  lens: 'links' | 'tags'
  activeNoteId: string | null
  onSelect: (id: string) => void
}

interface GNode {
  id: string
  label: string
  type: 'note' | 'tag'
  tags: string[]
  x: number; y: number
  vx: number; vy: number
}

interface GEdge { source: string; target: string }

const TAG_PALETTE = [
  '#2563eb', '#059669', '#7c3aed', '#ea580c', '#db2777', '#0891b2',
  '#65a30d', '#dc2626', '#d97706', '#4f46e5', '#0f766e', '#9333ea',
]
function tagHue(tag: string): string {
  let h = 0
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0
  return TAG_PALETTE[h % TAG_PALETTE.length]
}

function loadTagColors(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem('glyph-tag-colors') ?? '{}') } catch { return {} }
}
function saveTagColors(colors: Record<string, string>) {
  localStorage.setItem('glyph-tag-colors', JSON.stringify(colors))
}
function resolveColor(node: GNode, tagColors: Record<string, string>): string {
  const tag = node.type === 'tag' ? node.label : node.tags[0]
  return tag ? (tagColors[tag] ?? tagHue(tag)) : '#2563eb'
}

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return { r, g, b }
}

function buildGraph(notes: NoteMeta[], lens: 'links' | 'tags'): { nodes: GNode[]; edges: GEdge[] } {
  const nodes: GNode[] = []
  const edges: GEdge[] = []

  if (lens === 'links') {
    // Note nodes only, edges = explicit [[links]]
    for (const n of notes) {
      nodes.push({ id: n.id, label: n.title, type: 'note', tags: n.tags, x: 0, y: 0, vx: 0, vy: 0 })
    }
    const titleToId = new Map(notes.map(n => [n.title.toLowerCase(), n.id]))
    for (const n of notes) {
      for (const link of n.links) {
        const targetId = titleToId.get(link.toLowerCase())
        if (targetId && targetId !== n.id) {
          edges.push({ source: n.id, target: targetId })
        }
      }
    }
  } else {
    // Bipartite: note nodes + tag nodes, edges = note→tag membership
    for (const n of notes) {
      nodes.push({ id: n.id, label: n.title, type: 'note', tags: n.tags, x: 0, y: 0, vx: 0, vy: 0 })
    }
    const allTags = [...new Set(notes.flatMap(n => n.tags))]
    for (const tag of allTags) {
      nodes.push({ id: `tag:${tag}`, label: tag, type: 'tag', tags: [tag], x: 0, y: 0, vx: 0, vy: 0 })
    }
    for (const n of notes) {
      for (const tag of n.tags) {
        edges.push({ source: n.id, target: `tag:${tag}` })
      }
    }
  }

  return { nodes, edges }
}

function scatter(nodes: GNode[], cx: number, cy: number) {
  const r = Math.min(cx, cy) * 0.6
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI
    n.x = cx + r * Math.cos(angle) + (Math.random() - 0.5) * 40
    n.y = cy + r * Math.sin(angle) + (Math.random() - 0.5) * 40
  })
}

function tick(nodes: GNode[], edges: GEdge[], cx: number, cy: number) {
  const REPULSION = 2400
  const SPRING_LEN = 100
  const SPRING_K = 0.04
  const CENTER_K = 0.008
  const DAMP = 0.82

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x - nodes[i].x || 0.01
      const dy = nodes[j].y - nodes[i].y || 0.01
      const d2 = dx * dx + dy * dy
      const d = Math.sqrt(d2)
      const f = REPULSION / d2
      nodes[i].vx -= (dx / d) * f
      nodes[i].vy -= (dy / d) * f
      nodes[j].vx += (dx / d) * f
      nodes[j].vy += (dy / d) * f
    }
  }

  const idxMap = new Map(nodes.map((n, i) => [n.id, i]))
  for (const e of edges) {
    const si = idxMap.get(e.source); const ti = idxMap.get(e.target)
    if (si == null || ti == null) continue
    const s = nodes[si]; const t = nodes[ti]
    const dx = t.x - s.x || 0.01
    const dy = t.y - s.y || 0.01
    const d = Math.sqrt(dx * dx + dy * dy)
    const f = SPRING_K * (d - SPRING_LEN)
    const fx = (dx / d) * f; const fy = (dy / d) * f
    s.vx += fx; s.vy += fy
    t.vx -= fx; t.vy -= fy
  }

  for (const n of nodes) {
    n.vx += (cx - n.x) * CENTER_K
    n.vy += (cy - n.y) * CENTER_K
    n.vx *= DAMP; n.vy *= DAMP
    n.x += n.vx; n.y += n.vy
  }
}

interface Viewport { x: number; y: number; scale: number }

function draw(
  ctx: CanvasRenderingContext2D,
  nodes: GNode[],
  edges: GEdge[],
  lens: 'links' | 'tags',
  hoveredId: string | null,
  activeNoteId: string | null,
  dpr: number,
  vp: Viewport,
  tagColors: Record<string, string>
) {
  const { width, height } = ctx.canvas
  ctx.clearRect(0, 0, width, height)

  ctx.save()
  ctx.translate(vp.x, vp.y)
  ctx.scale(vp.scale, vp.scale)

  const idxMap = new Map(nodes.map((n, i) => [n.id, i]))
  const highlighted = new Set<string>()
  if (hoveredId) {
    highlighted.add(hoveredId)
    for (const e of edges) {
      if (e.source === hoveredId) highlighted.add(e.target)
      if (e.target === hoveredId) highlighted.add(e.source)
    }
  }
  const dimming = hoveredId !== null && highlighted.size > 0

  // Draw edges
  for (const e of edges) {
    const si = idxMap.get(e.source); const ti = idxMap.get(e.target)
    if (si == null || ti == null) continue
    const s = nodes[si]; const t = nodes[ti]
    const active = !dimming || (highlighted.has(e.source) && highlighted.has(e.target))
    ctx.beginPath()
    ctx.moveTo(s.x, s.y)
    ctx.lineTo(t.x, t.y)
    ctx.strokeStyle = active ? 'rgba(37,99,235,0.25)' : 'rgba(0,0,0,0.05)'
    ctx.lineWidth = active ? 1.5 / dpr : 1 / dpr
    ctx.stroke()
  }

  // Draw nodes
  for (const n of nodes) {
    const isActive = n.id === activeNoteId
    const isHovered = n.id === hoveredId
    const isDimmed = dimming && !highlighted.has(n.id)
    const isTag = n.type === 'tag'
    const r = isTag ? 6 : isActive ? 10 : 8

    const color = resolveColor(n, tagColors)

    const { r: cr, g: cg, b: cb } = hexToRgb(color)
    const alpha = isDimmed ? 0.2 : 1

    // Shadow for hovered/active
    if (isHovered || isActive) {
      ctx.shadowColor = color
      ctx.shadowBlur = 12 / dpr
    }

    ctx.beginPath()
    if (isTag) {
      // Diamond for tag nodes
      ctx.moveTo(n.x, n.y - r)
      ctx.lineTo(n.x + r, n.y)
      ctx.lineTo(n.x, n.y + r)
      ctx.lineTo(n.x - r, n.y)
      ctx.closePath()
    } else {
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
    }

    ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha * 0.15})`
    ctx.fill()
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`
    ctx.lineWidth = (isActive ? 2.5 : 1.5) / dpr
    ctx.stroke()

    ctx.shadowBlur = 0
    ctx.shadowColor = 'transparent'

    // Label
    if (!isDimmed || isHovered) {
      const fontSize = isTag ? 10 : 11
      ctx.font = `${isActive ? 600 : 400} ${fontSize / dpr}px system-ui, -apple-system, sans-serif`
      ctx.fillStyle = isDimmed ? 'rgba(0,0,0,0.2)' : isActive ? '#1a1d2e' : '#4b5563'
      ctx.textAlign = 'center'
      const label = n.label.length > 20 ? n.label.slice(0, 18) + '…' : n.label
      ctx.fillText(label, n.x, n.y + r + 13 / dpr)
    }
  }

  ctx.restore()
}

export function GraphView({ notes, lens, activeNoteId, onSelect }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const nodesRef    = useRef<GNode[]>([])
  const edgesRef    = useRef<GEdge[]>([])
  const rafRef      = useRef<number | null>(null)
  const hovered     = useRef<string | null>(null)
  const draggingRef = useRef<{ id: string; ox: number; oy: number } | null>(null)
  const panningRef  = useRef<{ startX: number; startY: number; vpX: number; vpY: number } | null>(null)
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, scale: 1 })
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [tagColors, setTagColors] = useState<Record<string, string>>(loadTagColors)
  const tagColorsRef = useRef(tagColors)
  tagColorsRef.current = tagColors
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tag: string } | null>(null)
  const lensRef   = useRef(lens)
  lensRef.current = lens
  const activeRef = useRef(activeNoteId)
  activeRef.current = activeNoteId
  const initialized = useRef(false)
  const stepsRef = useRef(0)

  const getCanvas = () => canvasRef.current
  const getDpr = () => window.devicePixelRatio || 1

  const redraw = useCallback(() => {
    const canvas = getCanvas(); if (!canvas) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    draw(ctx, nodesRef.current, edgesRef.current, lensRef.current, hovered.current, activeRef.current, getDpr(), viewportRef.current, tagColorsRef.current)
  }, [])

  const loop = useCallback(() => {
    stepsRef.current++
    const canvas = getCanvas(); if (!canvas) return
    const cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2
    tick(nodesRef.current, edgesRef.current, cx, cy)
    // Pin dragged node so simulation doesn't push it away
    const drag = draggingRef.current
    if (drag) {
      const node = nodesRef.current.find(n => n.id === drag.id)
      if (node) { node.vx = 0; node.vy = 0 }
    }
    redraw()
    if (stepsRef.current < 300) {
      rafRef.current = requestAnimationFrame(loop)
    } else {
      rafRef.current = null
    }
  }, [redraw])

  const startSimulation = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    stepsRef.current = 0
    rafRef.current = requestAnimationFrame(loop)
  }, [loop])

  // Rebuild graph when notes or lens changes
  useEffect(() => {
    const canvas = getCanvas(); if (!canvas) return
    const { nodes, edges } = buildGraph(notes, lens)
    const w = canvas.clientWidth, h = canvas.clientHeight
    const cx = (w || 400) / 2, cy = (h || 300) / 2
    if (!initialized.current || lens !== lensRef.current) {
      scatter(nodes, cx, cy)
      initialized.current = true
    } else {
      const prev = new Map(nodesRef.current.map(n => [n.id, n]))
      nodes.forEach(n => {
        const p = prev.get(n.id)
        if (p) { n.x = p.x; n.y = p.y; n.vx = p.vx; n.vy = p.vy }
        else { n.x = cx + (Math.random() - 0.5) * 100; n.y = cy + (Math.random() - 0.5) * 100 }
      })
    }
    nodesRef.current = nodes
    edgesRef.current = edges
    startSimulation()
  }, [notes, lens, startSimulation])

  // Handle resize — also re-scatter if this is the first meaningful size
  useEffect(() => {
    const canvas = getCanvas(); if (!canvas) return
    const dpr = getDpr()
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = canvas
      if (w === 0 || h === 0) return
      canvas.width = w * dpr
      canvas.height = h * dpr
      const ctx = canvas.getContext('2d')!
      ctx.scale(dpr, dpr)
      // If nodes haven't been scattered to real coordinates yet, do it now
      if (nodesRef.current.length > 0 && nodesRef.current[0].x === 0 && nodesRef.current[0].y === 0) {
        scatter(nodesRef.current, w / 2, h / 2)
        startSimulation()
      }
      redraw()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => { ro.disconnect(); if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [redraw, startSimulation])

  // Convert screen CSS px → world coordinates
  const toWorld = useCallback((sx: number, sy: number) => {
    const vp = viewportRef.current
    return { x: (sx - vp.x) / vp.scale, y: (sy - vp.y) / vp.scale }
  }, [])

  const hitTest = useCallback((sx: number, sy: number): string | null => {
    const { x, y } = toWorld(sx, sy)
    for (const n of nodesRef.current) {
      const dx = x - n.x, dy = y - n.y
      const r = (n.type === 'tag' ? 10 : 14) / viewportRef.current.scale
      if (dx * dx + dy * dy < r * r) return n.id
    }
    return null
  }, [toWorld])

  // Returns logical CSS pixel coordinates (matching node positions)
  const getCanvasXY = (e: { clientX: number; clientY: number; currentTarget: Element }) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasXY(e)
    const id = hitTest(x, y)
    if (id) {
      const { x: wx, y: wy } = toWorld(x, y)
      const node = nodesRef.current.find(n => n.id === id)
      if (node) {
        draggingRef.current = { id, ox: wx - node.x, oy: wy - node.y }
        e.currentTarget.style.cursor = 'grabbing'
        e.preventDefault()
        if (rafRef.current === null) startSimulation()
      }
    } else {
      // Start panning
      const vp = viewportRef.current
      panningRef.current = { startX: x, startY: y, vpX: vp.x, vpY: vp.y }
      e.currentTarget.style.cursor = 'grabbing'
      e.preventDefault()
    }
  }, [hitTest, toWorld, startSimulation])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasXY(e)

    if (panningRef.current) {
      didMoveRef.current = true
      const p = panningRef.current
      viewportRef.current.x = p.vpX + (x - p.startX)
      viewportRef.current.y = p.vpY + (y - p.startY)
      redraw()
      return
    }

    if (draggingRef.current) {
      didMoveRef.current = true
      const { x: wx, y: wy } = toWorld(x, y)
      const node = nodesRef.current.find(n => n.id === draggingRef.current!.id)
      if (node) {
        node.x = wx - draggingRef.current.ox
        node.y = wy - draggingRef.current.oy
        node.vx = 0; node.vy = 0
        if (rafRef.current === null) startSimulation()
        else redraw()
      }
      return
    }

    const id = hitTest(x, y)
    if (id !== hovered.current) {
      hovered.current = id
      setHoveredId(id)
      e.currentTarget.style.cursor = id ? 'pointer' : 'default'
      redraw()
    }
  }, [hitTest, toWorld, redraw, startSimulation])

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (panningRef.current) {
      panningRef.current = null
      e.currentTarget.style.cursor = 'default'
      return
    }
    if (draggingRef.current) {
      draggingRef.current = null
      e.currentTarget.style.cursor = 'default'
      startSimulation()
    }
  }, [startSimulation])

  const didMoveRef = useRef(false)
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (didMoveRef.current) { didMoveRef.current = false; return }
    const { x, y } = getCanvasXY(e)
    const id = hitTest(x, y)
    if (id && !id.startsWith('tag:')) onSelect(id)
  }, [hitTest, onSelect])

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const { x, y } = getCanvasXY(e)
    const id = hitTest(x, y)
    if (!id) return
    const node = nodesRef.current.find(n => n.id === id)
    if (!node) return
    const tag = node.type === 'tag' ? node.label : node.tags[0]
    if (!tag) return
    const MENU_W = 192, MENU_H = 160
    const mx = Math.max(8, Math.min(e.clientX, window.innerWidth  - MENU_W))
    const my = Math.max(8, Math.min(e.clientY, window.innerHeight - MENU_H))
    setContextMenu({ x: mx, y: my, tag })
  }, [hitTest])

  // Close context menu on any outside click
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [contextMenu])

  const handleMouseLeave = useCallback(() => {
    draggingRef.current = null
    panningRef.current = null
    hovered.current = null
    setHoveredId(null)
    redraw()
  }, [redraw])

  // Native wheel listener so preventDefault works reliably (React passive issue)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const vp = viewportRef.current

      // Always zoom toward cursor — smooth exponential scaling
      const delta = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY  // normalise line vs pixel mode
      const factor = Math.exp(-delta * 0.004)
      const newScale = Math.max(0.15, Math.min(5, vp.scale * factor))
      vp.x = x - (x - vp.x) * (newScale / vp.scale)
      vp.y = y - (y - vp.y) * (newScale / vp.scale)
      vp.scale = newScale
      redraw()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [redraw])

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
      />
      {notes.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: 'var(--overlay)', fontSize: 13, pointerEvents: 'none',
        }}>
          No notes to graph yet
        </div>
      )}
      {contextMenu && (
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y,
            background: 'rgba(255,255,255,0.97)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(0,0,0,0.09)',
            borderRadius: 10,
            padding: '10px 12px 12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.13)',
            zIndex: 9999, minWidth: 168,
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--subtext)', marginBottom: 8, letterSpacing: '-0.01em' }}>
            #{contextMenu.tag}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 5 }}>
            {TAG_PALETTE.map(hex => {
              const active = (tagColorsRef.current[contextMenu.tag] ?? tagHue(contextMenu.tag)) === hex
              return (
                <button
                  key={hex}
                  onClick={() => {
                    const updated = { ...tagColorsRef.current, [contextMenu.tag]: hex }
                    saveTagColors(updated)
                    setTagColors(updated)
                    setContextMenu(null)
                    redraw()
                  }}
                  style={{
                    width: 20, height: 20, borderRadius: '50%',
                    background: hex, border: 'none', cursor: 'pointer', padding: 0,
                    outline: active ? `2px solid ${hex}` : 'none',
                    outlineOffset: 2,
                    transform: active ? 'scale(1.2)' : 'scale(1)',
                    transition: 'transform 0.1s',
                  }}
                />
              )
            })}
          </div>
          {tagColorsRef.current[contextMenu.tag] && (
            <button
              onClick={() => {
                const updated = { ...tagColorsRef.current }
                delete updated[contextMenu.tag]
                saveTagColors(updated)
                setTagColors(updated)
                setContextMenu(null)
                redraw()
              }}
              style={{
                marginTop: 8, width: '100%', background: 'none', border: 'none',
                fontSize: 11, color: 'var(--subtext)', cursor: 'pointer',
                padding: '3px 0', textAlign: 'left', letterSpacing: '-0.01em',
              }}
            >
              Reset to default
            </button>
          )}
        </div>
      )}

      {hoveredId && !hoveredId.startsWith('tag:') && (() => {
        const n = nodesRef.current.find(x => x.id === hoveredId)
        if (!n) return null
        const canvas = canvasRef.current
        if (!canvas) return null
        const rect = canvas.getBoundingClientRect()
        const vp = viewportRef.current
        const px = n.x * vp.scale + vp.x
        const py = n.y * vp.scale + vp.y
        return (
          <div style={{
            position: 'absolute',
            left: px + rect.left < rect.right - 180 ? px + 14 : px - 170,
            top: Math.max(4, py - 16),
            background: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 8,
            padding: '5px 10px',
            fontSize: 12,
            color: 'var(--text)',
            pointerEvents: 'none',
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
            maxWidth: 160,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {n.label}
          </div>
        )
      })()}
    </div>
  )
}
