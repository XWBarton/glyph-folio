import { useState, useEffect, useRef, useCallback } from 'react'

interface CompileState {
  pdfBytes: Uint8Array | null
  error: string | null
  isCompiling: boolean
}

export function useNoteCompiler(body: string) {
  const [state, setState] = useState<CompileState>({
    pdfBytes: null,
    error: null,
    isCompiling: false
  })

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestBody = useRef(body)
  latestBody.current = body

  const compile = useCallback(async () => {
    setState(s => ({ ...s, isCompiling: true, error: null }))
    const result = await window.api.typstCompileNote(latestBody.current)
    if ('pdfBytes' in result) {
      setState({ pdfBytes: new Uint8Array(result.pdfBytes), error: null, isCompiling: false })
    } else {
      setState(s => ({ ...s, error: result.error, isCompiling: false }))
    }
  }, [])

  useEffect(() => {
    if (!body.trim()) {
      setState(s => ({ ...s, pdfBytes: null, error: null, isCompiling: false }))
      return
    }
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(compile, 400)
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [body, compile])

  return { ...state, compile }
}
