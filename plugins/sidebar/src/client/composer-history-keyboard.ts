import type { InputHistoryDirection } from './input-history.ts'

export interface ComposerCaret {
  readonly selectionEnd: number | null
  readonly selectionStart: number | null
  readonly value: string
}

export interface ComposerHistoryKey {
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly isComposing: boolean
  readonly key: string
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

/** Return a history direction only for unmodified, non-IME arrow keys. */
export function historyDirectionForKey(event: ComposerHistoryKey): InputHistoryDirection | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return null
  if (event.key === 'ArrowUp') return 'older'
  if (event.key === 'ArrowDown') return 'newer'
  return null
}

/** The browser retains normal multi-line navigation until the textual edge. */
export function isAtHistoryBoundary(
  input: ComposerCaret,
  direction: InputHistoryDirection,
): boolean {
  const { selectionStart, selectionEnd, value } = input
  if (selectionStart === null || selectionEnd === null || selectionStart !== selectionEnd) return false
  return direction === 'older' ? selectionStart === 0 : selectionEnd === value.length
}

