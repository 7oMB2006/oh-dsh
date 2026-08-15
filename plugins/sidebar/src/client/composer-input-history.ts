import {
  DEFAULT_INPUT_HISTORY_LIMIT,
  type InputHistoryEntry,
  InputHistory,
} from './input-history.ts'

export interface ComposerHistoryContentBlock {
  readonly text?: unknown
  readonly type?: unknown
}

export interface ComposerHistoryNode {
  readonly content?: unknown
  readonly kind?: unknown
  readonly seq?: unknown
}

export interface ComposerHistorySnapshot {
  readonly hasMore?: boolean
  readonly loadingOlder?: boolean
  readonly nodes?: readonly ComposerHistoryNode[]
}

export interface ComposerHistorySession {
  getSnapshot(): ComposerHistorySnapshot
  loadOlder?(): Promise<void>
}

function submittedInputEntry(node: ComposerHistoryNode): InputHistoryEntry | undefined {
  if ((node.kind !== 'user' && node.kind !== 'steering')
    || !Array.isArray(node.content) || typeof node.seq !== 'number') return undefined
  let value = ''
  for (const block of node.content) {
    if (typeof block !== 'object' || block === null) continue
    const content = block as ComposerHistoryContentBlock
    if (content.type === 'text' && typeof content.text === 'string') value += content.text
  }
  return value === '' ? undefined : { id: String(node.seq), value }
}

/** Extract only durable text user messages, in their session order. */
export function submittedInputEntries(
  nodes: readonly ComposerHistoryNode[] | undefined,
  cachedEntries?: WeakMap<ComposerHistoryNode, InputHistoryEntry>,
): InputHistoryEntry[] {
  if (nodes === undefined) return []
  const entries: InputHistoryEntry[] = []
  for (const node of nodes) {
    const cached = cachedEntries?.get(node)
    if (cached !== undefined) {
      entries.push(cached)
      continue
    }
    const entry = submittedInputEntry(node)
    if (entry === undefined) continue
    cachedEntries?.set(node, entry)
    entries.push(entry)
  }
  return entries
}

interface CachedSessionEntries {
  readonly nodes: readonly ComposerHistoryNode[] | undefined
  readonly sequences: readonly number[]
}

function submittedInputSequences(nodes: readonly ComposerHistoryNode[] | undefined): number[] {
  if (nodes === undefined) return []
  const sequences: number[] = []
  for (const node of nodes) {
    if ((node.kind === 'user' || node.kind === 'steering') && typeof node.seq === 'number') {
      sequences.push(node.seq)
    }
  }
  return sequences
}

function sameSequences(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((sequence, index) => sequence === right[index])
}

/**
 * Maps session ids to bounded input histories and serializes older-history
 * requests. All source data comes from confirmed conversation nodes.
 */
export class ComposerInputHistory {
  private readonly histories = new Map<string, InputHistory>()
  private readonly cachedEntries = new WeakMap<ComposerHistoryNode, InputHistoryEntry>()
  private readonly sessionEntries = new Map<string, CachedSessionEntries>()
  private readonly loading = new Set<string>()
  private readonly limit: number

  constructor(limit = DEFAULT_INPUT_HISTORY_LIMIT) {
    this.limit = limit
  }

  forSession(sessionId: string): InputHistory {
    let history = this.histories.get(sessionId)
    if (history === undefined) {
      history = new InputHistory(this.limit)
      this.histories.set(sessionId, history)
    }
    return history
  }

  synchronize(sessionId: string, snapshot: ComposerHistorySnapshot): boolean {
    const previous = this.sessionEntries.get(sessionId)
    if (previous?.nodes === snapshot.nodes) return false
    const sequences = submittedInputSequences(snapshot.nodes)
    if (previous !== undefined && sameSequences(previous.sequences, sequences)) {
      this.sessionEntries.set(sessionId, { nodes: snapshot.nodes, sequences })
      return false
    }
    const entries = submittedInputEntries(snapshot.nodes, this.cachedEntries)
    this.sessionEntries.set(sessionId, { nodes: snapshot.nodes, sequences })
    this.forSession(sessionId).synchronize(entries)
    return true
  }

  resetNavigation(sessionId: string | undefined): void {
    if (sessionId === undefined) return
    this.histories.get(sessionId)?.resetNavigation()
  }

  requestOlder(sessionId: string, session: ComposerHistorySession): boolean {
    const snapshot = session.getSnapshot()
    if (snapshot.hasMore !== true || snapshot.loadingOlder === true
      || this.loading.has(sessionId) || this.forSession(sessionId).size >= this.limit
      || session.loadOlder === undefined) return false
    this.loading.add(sessionId)
    void session.loadOlder().catch(() => {
      // Conversation state owns the recoverable load error presentation.
    }).finally(() => {
      this.loading.delete(sessionId)
    })
    return true
  }
}
