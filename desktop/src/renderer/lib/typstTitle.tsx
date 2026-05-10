import React from 'react'

// Parse Typst inline markup in a note title and return a styled React node.
// Handles: *bold*, _italic_, *_bold italic_*, _*bold italic*_
const TITLE_RE = /\*_([^_*\n]+)_\*|_\*([^*_\n]+)\*_|\*([^*\n]+)\*|_([^_\n]+)_/g

export function renderTypstTitle(title: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  TITLE_RE.lastIndex = 0

  while ((match = TITLE_RE.exec(title)) !== null) {
    if (match.index > last) parts.push(title.slice(last, match.index))
    const [, bi1, bi2, b, i] = match
    if (bi1 ?? bi2) {
      parts.push(<span key={match.index} style={{ fontWeight: 700, fontStyle: 'italic' }}>{bi1 ?? bi2}</span>)
    } else if (b) {
      parts.push(<span key={match.index} style={{ fontWeight: 700 }}>{b}</span>)
    } else if (i) {
      parts.push(<span key={match.index} style={{ fontStyle: 'italic' }}>{i}</span>)
    }
    last = match.index + match[0].length
  }

  if (last < title.length) parts.push(title.slice(last))
  if (parts.length === 1 && typeof parts[0] === 'string') return title
  return <>{parts}</>
}
