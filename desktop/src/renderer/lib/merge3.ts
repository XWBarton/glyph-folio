// @ts-ignore
import { diff3Merge } from 'node-diff3'

export interface MergeResult {
  merged: string
  hasConflicts: boolean
}

/**
 * 3-way merge of plain text.
 * base  = what both sides last agreed on (last sync)
 * local = local edits since last sync
 * remote = remote edits since last sync
 *
 * Non-overlapping changes are merged automatically.
 * Overlapping changes produce inline conflict markers visible in the editor.
 */
export function merge3(base: string, local: string, remote: string): MergeResult {
  const baseLines   = base.split('\n')
  const localLines  = local.split('\n')
  const remoteLines = remote.split('\n')

  const chunks = diff3Merge(localLines, baseLines, remoteLines) as Array<
    | { ok: string[] }
    | { conflict: { a: string[]; o: string[]; b: string[] } }
  >

  const out: string[] = []
  let hasConflicts = false

  for (const chunk of chunks) {
    if ('ok' in chunk) {
      out.push(...chunk.ok)
    } else {
      hasConflicts = true
      out.push(
        '// <<<<<<< local',
        ...chunk.conflict.a,
        '// =======',
        ...chunk.conflict.b,
        '// >>>>>>> server',
      )
    }
  }

  return { merged: out.join('\n'), hasConflicts }
}
