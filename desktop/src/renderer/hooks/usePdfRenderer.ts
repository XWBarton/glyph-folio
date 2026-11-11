import { useEffect, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

// @ts-ignore
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const WRAPPER_PAD_Y = 24 // top+bottom padding in `padding: 12px 24px` below

// Preview scroll position per note, so switching notes (tabs) returns to where
// you were. Module-level so it survives the preview pane remounting.
const noteScrollTops = new Map<string, number>()

export function usePdfRenderer(
  containerRef: React.RefObject<HTMLDivElement | null>,
  pdfBytes: Uint8Array | null,
  zoom: number = 1,
  fitKey: number = 0,
  noteId?: string
) {
  const versionRef = useRef(0)
  // Note whose PDF is currently on screen, and the bytes it was rendered from
  const shownNoteIdRef = useRef<string | undefined>(undefined)
  const shownPdfRef = useRef<Uint8Array | null>(null)

  // Remember the scroll position of whichever note is on screen
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onScroll = () => {
      const id = shownNoteIdRef.current
      if (id) noteScrollTops.set(id, container.scrollTop)
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [containerRef])

  useEffect(() => {
    if (!pdfBytes || !containerRef.current) return

    const isSameNote = noteId === shownNoteIdRef.current
    // Just switched notes but the new note hasn't compiled yet — these are
    // still the previous note's bytes, so leave its preview up untouched.
    if (!isSameNote && pdfBytes === shownPdfRef.current) return

    const version = ++versionRef.current
    const container = containerRef.current

    // Same-note recompile keeps the current scroll (otherwise every keystroke
    // would jump back to page 1); a switch restores where that note was left.
    const prevScrollTop = isSameNote
      ? container.scrollTop
      : (noteId !== undefined ? noteScrollTops.get(noteId) ?? 0 : 0)
    const viewClientHeight = container.clientHeight

    const run = async () => {
      try {
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) }).promise
        if (version !== versionRef.current) return

        // Cap rasterization density: full devicePixelRatio is overkill on
        // image-heavy pages and multiplies canvas-render cost for little
        // visible benefit beyond ~2x.
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const availableWidth = container.clientWidth - 48

        // Fetch every page + its target viewport up front — cheap (page
        // metadata only, no rasterization) — so we know each page's final
        // size before rendering anything.
        const pageNums = Array.from({ length: doc.numPages }, (_, i) => i + 1)
        const pages = await Promise.all(pageNums.map(n => doc.getPage(n)))
        if (version !== versionRef.current) return

        const viewports = pages.map(page => {
          const baseViewport = page.getViewport({ scale: 1 })
          const fitScale = availableWidth / baseViewport.width
          return page.getViewport({ scale: fitScale * zoom * dpr })
        })

        const heights = viewports.map(v => v.height / dpr + WRAPPER_PAD_Y)
        let offset = 0
        const tops = heights.map(h => { const t = offset; offset += h; return t })

        // Build all wrapper placeholders off-DOM first (correctly sized, so
        // scroll position stays stable), then swap in atomically.
        const wrappers = viewports.map(viewport => {
          const wrapper = document.createElement('div')
          wrapper.style.cssText = `padding: 12px 24px; min-height: ${viewport.height / dpr}px;`
          return wrapper
        })
        const fragment = document.createDocumentFragment()
        wrappers.forEach(w => fragment.appendChild(w))

        container.innerHTML = ''
        container.appendChild(fragment)
        shownNoteIdRef.current = noteId
        shownPdfRef.current = pdfBytes
        container.scrollTop = prevScrollTop

        const renderPage = async (i: number) => {
          if (version !== versionRef.current) return
          const viewport = viewports[i]
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.style.cssText = `
            display: block;
            width: ${viewport.width / dpr}px;
            height: ${viewport.height / dpr}px;
            margin: 0 auto;
            border-radius: 4px;
            box-shadow: 0 2px 16px rgba(0,0,0,0.10);
          `
          await pages[i].render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
          if (version !== versionRef.current) return
          wrappers[i].style.minHeight = ''
          wrappers[i].appendChild(canvas)
        }

        // Render whatever's currently in (or near) the scrolled viewport
        // first, so a long, image-heavy document's preview updates almost
        // immediately for what the user is actually looking at — measured
        // ~9x faster than rendering every page (e.g. ~55ms vs ~500ms for a
        // 14-page/19-image note). The rest fills in just after, in the
        // background, without blocking that first paint.
        const viewTop = prevScrollTop
        const viewBottom = prevScrollTop + viewClientHeight
        const buffer = viewClientHeight || 800
        const visible: number[] = []
        const rest: number[] = []
        tops.forEach((top, i) => {
          const bottom = top + heights[i]
          if (bottom >= viewTop - buffer && top <= viewBottom + buffer) visible.push(i)
          else rest.push(i)
        })
        if (visible.length === 0) visible.push(0)

        await Promise.all(visible.map(renderPage))
        if (version !== versionRef.current) return
        Promise.all(rest.map(renderPage)).catch(e => console.error('PDF background render error:', e))
      } catch (e) {
        console.error('PDF render error:', e)
      }
    }

    run()
  }, [pdfBytes, containerRef, zoom, fitKey, noteId])
}
