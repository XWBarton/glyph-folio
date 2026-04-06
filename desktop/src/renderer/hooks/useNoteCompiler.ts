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

  const debounceTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestBody     = useRef(body)
  const isRunning      = useRef(false)
  const hasPending     = useRef(false)
  latestBody.current   = body

  const compile = useCallback(async () => {
    // If a compilation is already in flight, just mark that we need another run
    // and return. When the current one finishes it will pick up the latest body.
    if (isRunning.current) { hasPending.current = true; return }

    isRunning.current = true
    hasPending.current = false
    setState(s => ({ ...s, isCompiling: true, error: null }))

    const result = await window.api.typstCompileNote(latestBody.current)

    isRunning.current = false
    if ('pdfBytes' in result) {
      setState({ pdfBytes: new Uint8Array(result.pdfBytes), error: null, isCompiling: false })
    } else {
      setState(s => ({ ...s, error: result.error, isCompiling: false }))
    }

    // If body changed while we were compiling, run once more
    if (hasPending.current) {
      hasPending.current = false
      compile()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!body.trim()) {
      setState(s => ({ ...s, pdfBytes: null, error: null, isCompiling: false }))
      return
    }
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(compile, 600)
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current) }
  }, [body, compile])

  return { ...state, compile }
}
