export interface ComposerHistoryInput {
  setDraft(text: string): void
}

export interface ComposerHistoryContext {
  get(name: string): unknown
}

export interface ComposerHistorySessions {
  scope?(id: string): unknown
}

interface ConversationInputService {
  input: {
    for(context: unknown): ComposerHistoryInput
  }
}

/** Resolve the public composer write path, degrading silently on old runtimes. */
export function composerInputForSession(
  ctx: ComposerHistoryContext,
  sessions: ComposerHistorySessions,
  sessionId: string,
): ComposerHistoryInput | undefined {
  const scope = sessions.scope?.(sessionId)
  if (scope === undefined) return undefined
  try {
    const conversation = ctx.get('conversation') as ConversationInputService | undefined
    return conversation?.input.for(scope)
  } catch {
    return undefined
  }
}

