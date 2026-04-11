import type * as Monaco from 'monaco-editor'

export interface TokenDef {
  id: string
  label: string
  description: string
  token: string       // monarch token name (postfix .typst added automatically)
  defaultColor: string
  fontStyle: string   // fixed — not user-configurable to keep things simple
}

export const TOKEN_DEFS: TokenDef[] = [
  { id: 'heading',   label: 'Heading',          description: '= Title, == Section…',   token: 'heading',   defaultColor: '#1d4ed8', fontStyle: 'bold' },
  { id: 'keyword',   label: 'Keyword',           description: '#set, #let, #show, #if…',token: 'keyword',  defaultColor: '#7c3aed', fontStyle: 'bold' },
  { id: 'function',  label: 'Function',          description: '#name, #rect, #align…',  token: 'function',  defaultColor: '#0369a1', fontStyle: '' },
  { id: 'bold',      label: 'Bold text',         description: '*bold*',                  token: 'bold',      defaultColor: '#111827', fontStyle: 'bold' },
  { id: 'italic',    label: 'Italic text',       description: '_italic_',                token: 'italic',    defaultColor: '#374151', fontStyle: 'italic' },
  { id: 'string',    label: 'String',            description: '"text"',                  token: 'string',    defaultColor: '#059669', fontStyle: '' },
  { id: 'number',    label: 'Number / Unit',     description: '12pt, 50%, 1.5em…',      token: 'number',    defaultColor: '#b45309', fontStyle: '' },
  { id: 'comment',   label: 'Comment',           description: '// line  /* block */',    token: 'comment',   defaultColor: '#9ca3af', fontStyle: 'italic' },
  { id: 'math',      label: 'Math',              description: '$x^2 + y^2$',             token: 'math',      defaultColor: '#c2410c', fontStyle: '' },
  { id: 'raw',       label: 'Raw / Code',        description: '`inline`  ```block```',   token: 'raw',       defaultColor: '#0f766e', fontStyle: '' },
  { id: 'label',     label: 'Label',             description: '<fig:one>',               token: 'label',     defaultColor: '#7e22ce', fontStyle: '' },
  { id: 'reference', label: 'Reference',         description: '@fig:one',                token: 'reference', defaultColor: '#be185d', fontStyle: '' },
  { id: 'list',      label: 'List marker',       description: '-, +, 1.',                token: 'list',      defaultColor: '#2563eb', fontStyle: 'bold' },
  { id: 'escape',    label: 'Escape',            description: '\\* \\_ \\#…',           token: 'escape',    defaultColor: '#6b7280', fontStyle: '' },
  { id: 'rule',      label: 'Horizontal rule',   description: '---',                     token: 'rule',      defaultColor: '#d1d5db', fontStyle: '' },
]

// Dark-mode defaults — lighter/more saturated to read on dark backgrounds
export const DARK_DEFAULT_TOKEN_COLORS: TokenColors = {
  heading:   '#60a5fa',
  keyword:   '#a78bfa',
  function:  '#38bdf8',
  bold:      '#f1f5f9',
  italic:    '#cbd5e1',
  string:    '#34d399',
  number:    '#fbbf24',
  comment:   '#6b7280',
  math:      '#fb923c',
  raw:       '#2dd4bf',
  label:     '#c084fc',
  reference: '#f472b6',
  list:      '#93c5fd',
  escape:    '#94a3b8',
  rule:      '#374151',
}

export type TokenColors = Record<string, string>  // id → hex color

export const DEFAULT_TOKEN_COLORS: TokenColors = Object.fromEntries(
  TOKEN_DEFS.map(d => [d.id, d.defaultColor])
)

const EDITOR_UI_COLORS_LIGHT = {
  'editor.background': '#f5f8ff00',
  'editor.foreground': '#1a1d2e',
  'editorLineNumber.foreground': '#c4c9d6',
  'editorLineNumber.activeForeground': '#6b7280',
  'editor.lineHighlightBackground': '#0000000a',
  'editor.selectionBackground': '#2563eb26',
  'editor.inactiveSelectionBackground': '#2563eb14',
  'editorCursor.foreground': '#2563eb',
  'editorWhitespace.foreground': '#e5e7eb',
  'editorIndentGuide.background1': '#e5e7eb',
  'editorIndentGuide.activeBackground1': '#d1d5db',
  'scrollbarSlider.background': '#00000018',
  'scrollbarSlider.hoverBackground': '#00000030',
  'scrollbarSlider.activeBackground': '#00000040',
  'editorSuggestWidget.background': '#f4f7ff',
  'editorSuggestWidget.border': '#ffffffcc',
  'editorSuggestWidget.foreground': '#1a1d2e',
  'editorSuggestWidget.selectedBackground': '#2563eb18',
  'editorSuggestWidget.selectedForeground': '#1e3a8a',
  'editorSuggestWidget.highlightForeground': '#2563eb',
  'editorSuggestWidget.selectedHighlightForeground': '#1e3a8a',
  'editorSuggestWidget.focusHighlightForeground': '#2563eb',
}

const EDITOR_UI_COLORS_DARK = {
  'editor.background': '#1e213000',   // transparent — matches app background
  'editor.foreground': '#e2e8f0',
  'editorLineNumber.foreground': '#3d4258',
  'editorLineNumber.activeForeground': '#6b7280',
  'editor.lineHighlightBackground': '#ffffff08',
  'editor.selectionBackground': '#60a5fa28',
  'editor.inactiveSelectionBackground': '#60a5fa14',
  'editorCursor.foreground': '#60a5fa',
  'editorWhitespace.foreground': '#2d3148',
  'editorIndentGuide.background1': '#2d3148',
  'editorIndentGuide.activeBackground1': '#3d4258',
  'scrollbarSlider.background': '#ffffff10',
  'scrollbarSlider.hoverBackground': '#ffffff20',
  'scrollbarSlider.activeBackground': '#ffffff30',
  'editorSuggestWidget.background': '#1e2130',
  'editorSuggestWidget.border': '#ffffff18',
  'editorSuggestWidget.foreground': '#e2e8f0',
  'editorSuggestWidget.selectedBackground': '#60a5fa20',
  'editorSuggestWidget.selectedForeground': '#bfdbfe',
  'editorSuggestWidget.highlightForeground': '#60a5fa',
  'editorSuggestWidget.selectedHighlightForeground': '#bfdbfe',
  'editorSuggestWidget.focusHighlightForeground': '#60a5fa',
}

export function buildMonacoTheme(
  colors: TokenColors,
  dark = false
): Monaco.editor.IStandaloneThemeData {
  const darkDefaults = DARK_DEFAULT_TOKEN_COLORS
  const rules: Monaco.editor.ITokenThemeRule[] = TOKEN_DEFS.map(def => ({
    token: `${def.token}.typst`,
    foreground: (colors[def.id] ?? (dark ? darkDefaults[def.id] : def.defaultColor)).replace('#', ''),
    fontStyle: def.fontStyle
  }))

  rules.push({ token: 'wiki-link.typst', foreground: dark ? '60a5fa' : '2563eb', fontStyle: 'underline' })

  return {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules,
    colors: dark ? EDITOR_UI_COLORS_DARK : EDITOR_UI_COLORS_LIGHT,
  }
}
