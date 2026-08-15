/** Browser paste bridge and thumbnail dock for Desktop and Web UI. */

import { VisionDraftDock } from './VisionDraftDock.tsx'
import { VisionDraftStore } from './draft-store.ts'
import styles from './vision.css'
import {
  isVisionImageMediaType,
  VISION_REFERENCE_SOURCE,
  visionModelReference,
} from '../protocol.ts'

interface InputSnapshot {
  draft: string
  draftRev: number
  occurrences: readonly { offset: number; ref: string; source: string }[]
}

interface SessionInput {
  setDraft(value: string): void
  state: { getSnapshot(): InputSnapshot }
}

interface AgentContext {
  bail(context: AgentContext, event: string, request: unknown): true | undefined
  get(name: string): unknown
}

interface VisionClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  inputTriggers: { registerSource(source: VisionInputTriggerSource): () => void }
  sessions: { scope(id: string): AgentContext | undefined }
  slots: {
    inject(name: string, register: () => unknown): void
    register(entry: unknown, component: unknown): unknown
  }
}

interface VisionInputTriggerSource {
  candidates(): Promise<readonly never[]>
  codec: {
    clipboardText(id: string): string
    serialize(id: string, signal: AbortSignal): Promise<string>
  }
  name: string
  onPick(): undefined
  order: number
  trigger: '@'
}

interface ConversationInputService {
  input: { for(context: AgentContext): SessionInput }
}

export const inject = ['slots', 'sessions', 'conversation', 'inputTriggers']

function inputFor(ctx: VisionClientContext, sessionId: string): {
  context: AgentContext
  input: SessionInput
} | undefined {
  const context = ctx.sessions.scope(sessionId)
  if (context === undefined) return undefined
  const conversation = context.get('conversation') as ConversationInputService | undefined
  if (conversation === undefined) return undefined
  return { context, input: conversation.input.for(context) }
}

function insertClipboard(
  ctx: VisionClientContext,
  store: VisionDraftStore,
  sessionId: string,
  textarea: HTMLTextAreaElement,
  files: readonly File[],
  text: string,
): void {
  const scoped = inputFor(ctx, sessionId)
  if (scoped === undefined) return
  let start = textarea.selectionStart ?? scoped.input.state.getSnapshot().draft.length
  let end = textarea.selectionEnd ?? start

  if (text !== '') {
    const state = scoped.input.state.getSnapshot()
    const inserted = scoped.context.bail(scoped.context, 'slash/input-insert-text', {
      text,
      span: { start, end, draftRev: state.draftRev },
    }) === true
    if (!inserted) return
    start += text.length
    end = start
  }

  for (const file of files) {
    const state = scoped.input.state.getSnapshot()
    const id = crypto.randomUUID()
    const inserted = scoped.context.bail(scoped.context, 'slash/input-insert-reference', {
      reference: {
        source: VISION_REFERENCE_SOURCE,
        ref: id,
        label: file.name || 'Pasted image',
        clipboardText: `[pasted image: ${file.name || 'image'}]`,
      },
      span: { start, end, draftRev: state.draftRev },
    }) === true
    if (!inserted) break
    store.add(sessionId, id, file)
    start += 1
    end = start
  }

  queueMicrotask(() => {
    textarea.focus({ preventScroll: true })
    textarea.setSelectionRange(start, start)
  })
}

function removeDraft(
  ctx: VisionClientContext,
  store: VisionDraftStore,
  sessionId: string,
  id: string,
): void {
  const scoped = inputFor(ctx, sessionId)
  const state = scoped?.input.state.getSnapshot()
  const occurrence = state?.occurrences.find(item =>
    item.source === VISION_REFERENCE_SOURCE && item.ref === id)
  if (scoped !== undefined && state !== undefined && occurrence !== undefined
    && state.draft[occurrence.offset] === '\uFFFC') {
    scoped.input.setDraft(
      state.draft.slice(0, occurrence.offset) + state.draft.slice(occurrence.offset + 1),
    )
  }
  store.remove(id)
}

/** Mount the Desktop/Web thumbnail bubble and text-model-safe image references. */
export function apply(ctx: VisionClientContext): void {
  const store = new VisionDraftStore()
  ctx.effect(() => () => { store.dispose() }, 'oh-dsh-vision: pasted image drafts')

  const source: VisionInputTriggerSource = {
    trigger: '@',
    name: VISION_REFERENCE_SOURCE,
    order: 1000,
    candidates: async () => [],
    onPick: () => undefined,
    codec: {
      clipboardText: id => `[pasted image: ${id}]`,
      serialize: async (id, signal) => visionModelReference(await store.serialize(id, signal)),
    },
  }
  ctx.effect(
    () => ctx.inputTriggers.registerSource(source),
    'oh-dsh-vision: pasted image reference codec',
  )

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.ohDshVisionStyles = 'true'
    style.textContent = styles
    document.head.append(style)
    return () => { style.remove() }
  }, 'oh-dsh-vision: thumbnail styles')

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'oh-dsh-vision-images',
    order: -20,
    inject: (sessionId: string) => ({
      store,
      onRemove: (id: string) => { removeDraft(ctx, store, sessionId, id) },
      onPaste: (event: ClipboardEvent) => {
        const target = event.target
        if (!(target instanceof HTMLTextAreaElement)
          || target.closest('[data-composer-card]') === null
          || target.disabled
          || target.readOnly
          || event.clipboardData === null) return
        const files = [...event.clipboardData.items]
          .filter(item => item.kind === 'file' && isVisionImageMediaType(item.type))
          .flatMap(item => {
            const file = item.getAsFile()
            return file === null ? [] : [file]
          })
          .slice(0, 20)
        if (files.length === 0) return
        event.preventDefault()
        event.stopPropagation()
        insertClipboard(
          ctx,
          store,
          sessionId,
          target,
          files,
          event.clipboardData.getData('text/plain'),
        )
      },
    }),
  }, VisionDraftDock))
}
