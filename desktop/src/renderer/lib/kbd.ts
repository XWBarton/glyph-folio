export const isMac = navigator.platform.startsWith('Mac')

const ORDER = ['Ctrl', 'Alt', 'Shift'] as const
const MAP: Record<string, (typeof ORDER)[number]> = { '⌘': 'Ctrl', '⌃': 'Ctrl', '⌥': 'Alt', '⇧': 'Shift' }

/**
 * Shortcut labels are written Mac-style (⇧⌘D, ⌘-click). On Windows/Linux turn
 * them into the conventional form: Ctrl+Shift+D, Ctrl+click.
 */
export function kbd(label: string): string {
  if (isMac) return label
  return label.replace(/([⌘⌃⌥⇧]+)([-+]?)/g, (_, mods: string) => {
    const set = new Set([...mods].map(m => MAP[m]))
    return ORDER.filter(m => set.has(m)).join('+') + '+'
  })
}
