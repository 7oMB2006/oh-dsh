import { DEFAULT_INPUT_HISTORY_LIMIT, InputHistory } from './input-history.ts'

export interface ComposerHistoryContentBlock {
  readonly text?: unknown
  readonly type?: unknown
}

export interface ComposerHistoryNode {
  readonly content?: unknown
  readonly kind?: unknown
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

/** Extract only durable text user messages, in their session order. */
export function submittedInputTexts(nodes: readonly ComposerHistoryNode[] | undefined): string[] {
  if (nodes === undefined) return []
  const texts: string[] = []
  for (const node of nodes) {
    if ((node.kind !== 'user' && node.kind !== 'steering') || !Array.isArray(node.content)) continue
    const text = node.content
      .filter((block): block is ComposerHistoryContentBlock =>
        typeof block === 'object' && block !== null
        && (block as ComposerHistoryContentBlock).type === 'text'
        && typeof (block as ComposerHistoryContentBlock).text === 'string')
      .map(block => block.text as string)
      .join('')
    if (text !== '') texts.push(text)
  }
  return texts
}

/**
 * Maps session ids to bounded input histories and serializes older-history
 * requests. All source data comes from confirmed conversation nodes.
 */
export class ComposerInputHistory {
  private readonly histories = new Map<string, InputHistory>()
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

  synchronize(sessionId: string, snapshot: ComposerHistorySnapshot): void {
    this.forSession(sessionId).synchronize(submittedInputTexts(snapshot.nodes))
  }

  resetNavigation(sessionId: string | undefined): void {
    if (sessionId === undefined) return
    this.histories.get(sessionId)?.resetNavigation()
  }

  requestOlder(sessionId: string, session: ComposerHistorySession): boolean {
    const snapshot = session.getSnapshot()
    if (snapshot.hasMore !== true || snapshot.loadingOlder === true
      || this.loading.has(sessionId) || this.forSession(sessionId).snapshot().entries.length >= this.limit
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
