/** Session-scoped history for the conversation composer. */

export const DEFAULT_INPUT_HISTORY_LIMIT = 100

export interface InputHistoryState {
  readonly entries: readonly string[]
  readonly cursor: number | null
  readonly draft: string | null
}

export type InputHistoryDirection = 'older' | 'newer'

export interface InputHistoryResult {
  readonly state: InputHistoryState
  readonly value: string | null
  readonly changed: boolean
}

/**
 * Keeps navigation state separate from the renderer. Entries are oldest first;
 * cursor is an entry index while browsing and null while editing the draft.
 */
export class InputHistory {
  private entries: string[] = []
  private cursor: number | null = null
  private draft: string | null = null
  private readonly limit: number

  constructor(limit = DEFAULT_INPUT_HISTORY_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError('input history limit must be a positive integer')
    }
    this.limit = limit
  }

  snapshot(): InputHistoryState {
    return {
      entries: this.entries,
      cursor: this.cursor,
      draft: this.draft,
    }
  }

  resetNavigation(): void {
    this.cursor = null
    this.draft = null
  }

  clear(): void {
    this.entries = []
    this.resetNavigation()
  }

  record(value: string): void {
    if (value.trim() === '') return
    const previous = this.entries.at(-1)
    if (previous !== value) this.entries.push(value)
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit)
    this.resetNavigation()
  }

  seed(values: readonly string[]): void {
    for (const value of values) this.record(value)
  }

  /** Replace entries from the authoritative session window without losing a selected item. */
  synchronize(values: readonly string[]): void {
    const selected = this.cursor === null ? null : this.entries[this.cursor]
    const draft = this.draft
    const next: string[] = []
    for (const value of values) {
      if (value.trim() === '' || next.at(-1) === value) continue
      next.push(value)
    }
    if (next.length > this.limit) next.splice(0, next.length - this.limit)
    this.entries = next
    if (selected === null) return
    if (selected === undefined) {
      this.resetNavigation()
      return
    }
    const cursor = next.lastIndexOf(selected)
    if (cursor === -1) {
      this.resetNavigation()
      return
    }
    this.cursor = cursor
    this.draft = draft
  }

  navigate(direction: InputHistoryDirection, currentValue: string): InputHistoryResult {
    if (this.entries.length === 0) {
      return { state: this.snapshot(), value: null, changed: false }
    }
    if (this.cursor === null) this.draft = currentValue
    const next = direction === 'older'
      ? this.cursor === null ? this.entries.length - 1 : this.cursor === 0 ? null : this.cursor - 1
      : this.cursor === null ? null : this.cursor + 1
    if (next === null || next >= this.entries.length) {
      if (direction === 'newer' && this.cursor !== null) {
        this.cursor = null
        const value = this.draft ?? ''
        this.draft = null
        return { state: this.snapshot(), value, changed: true }
      }
      return { state: this.snapshot(), value: null, changed: false }
    }
    this.cursor = next
    return { state: this.snapshot(), value: this.entries[next] ?? '', changed: true }
  }
}
