import { useEffect, useSyncExternalStore } from 'react'
import { VISION_REFERENCE_SOURCE } from '../protocol.ts'
import type { VisionDraftStore } from './draft-store.ts'

interface VisionOccurrence {
  offset: number
  ref: string
  source: string
}

interface VisionInputState {
  draftRev: number
  occurrences: readonly VisionOccurrence[]
}

export interface VisionDraftDockProps {
  input: VisionInputState
  onPaste(event: ClipboardEvent): void
  onRemove(id: string): void
  sessionId: string
  store: VisionDraftStore
}

export function VisionDraftDock({
  input,
  onPaste,
  onRemove,
  sessionId,
  store,
}: VisionDraftDockProps): React.JSX.Element | null {
  useSyncExternalStore(store.subscribe, store.getRevision, store.getRevision)
  const drafts = store.list(sessionId)

  useEffect(() => {
    const listener = (event: ClipboardEvent): void => { onPaste(event) }
    document.addEventListener('paste', listener, true)
    return () => { document.removeEventListener('paste', listener, true) }
  }, [onPaste])

  useEffect(() => {
    store.prune(sessionId, new Set(input.occurrences
      .filter(item => item.source === VISION_REFERENCE_SOURCE)
      .map(item => item.ref)))
  }, [input.draftRev, input.occurrences, sessionId, store])

  if (drafts.length === 0) return null
  return (
    <div className="ohVisionDraftRail" role="group" aria-label="Pasted images">
      {drafts.map(draft => (
        <div
          className="ohVisionDraftBubble"
          data-oh-dsh-vision-draft
          data-status={draft.status}
          key={draft.id}
          title={draft.status === 'error' ? draft.error : draft.name}
        >
          <img src={draft.previewUrl} alt={draft.name} />
          <button
            aria-label={`Remove ${draft.name}`}
            className="ohVisionDraftRemove"
            onClick={() => { onRemove(draft.id) }}
            type="button"
          >
            ×
          </button>
          {draft.status === 'uploading' && <span className="ohVisionDraftSpinner" aria-label="Uploading image" />}
          {draft.status === 'error' && <span className="ohVisionDraftError" aria-label={draft.error ?? 'Image upload failed'}>!</span>}
        </div>
      ))}
    </div>
  )
}
