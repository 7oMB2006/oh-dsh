import {
  isVisionImageMediaType,
  VISION_ATTACHMENT_API_PATH,
  visionAttachmentToken,
  type VisionAttachmentUploadResult,
} from '../protocol.ts'

export type VisionDraftStatus = 'uploading' | 'ready' | 'error'

export interface VisionDraftImage {
  readonly id: string
  readonly name: string
  readonly previewUrl: string
  readonly sessionId: string
  error?: string
  status: VisionDraftStatus
}

interface VisionDraftRecord extends VisionDraftImage {
  readonly abort: AbortController
  readonly source: Promise<string>
}

export interface VisionDraftStoreOptions {
  createPreview?: (file: File) => string
  revokePreview?: (url: string) => void
  upload?: (sessionId: string, file: File, signal: AbortSignal) => Promise<string>
}

async function fileBase64(file: File, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    const abort = (): void => reader.abort()
    signal.addEventListener('abort', abort, { once: true })
    reader.addEventListener('abort', () => reject(signal.reason), { once: true })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('image read failed')), { once: true })
    reader.addEventListener('load', () => {
      signal.removeEventListener('abort', abort)
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('image read returned no data'))
        return
      }
      const comma = result.indexOf(',')
      if (comma < 0) {
        reject(new Error('image read returned an invalid data URL'))
        return
      }
      resolve(result.slice(comma + 1))
    }, { once: true })
    reader.readAsDataURL(file)
  })
}

async function uploadVisionImage(
  sessionId: string,
  file: File,
  signal: AbortSignal,
): Promise<string> {
  if (!isVisionImageMediaType(file.type)) throw new Error(`Unsupported image format: ${file.type}`)
  const response = await fetch(VISION_ATTACHMENT_API_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      data: await fileBase64(file, signal),
      mediaType: file.type,
      name: file.name,
      sessionId,
    }),
    signal,
  })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error(`Image upload failed (${String(response.status)})`)
  }
  const body = payload as Partial<VisionAttachmentUploadResult> & { error?: unknown }
  if (!response.ok) {
    throw new Error(typeof body.error === 'string'
      ? body.error
      : `Image upload failed (${String(response.status)})`)
  }
  if (typeof body.source !== 'string' || visionAttachmentToken(body.source) === undefined) {
    throw new Error('Image upload returned an invalid reference')
  }
  return body.source
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

/** Runtime-only pasted-image drafts; the input occurrence owns their lifetime. */
export class VisionDraftStore {
  private readonly records = new Map<string, VisionDraftRecord>()
  private readonly listeners = new Set<() => void>()
  private readonly createPreview: (file: File) => string
  private readonly revokePreview: (url: string) => void
  private readonly upload: (sessionId: string, file: File, signal: AbortSignal) => Promise<string>
  private revision = 0

  constructor(options: VisionDraftStoreOptions = {}) {
    this.createPreview = options.createPreview ?? (file => URL.createObjectURL(file))
    this.revokePreview = options.revokePreview ?? (url => { URL.revokeObjectURL(url) })
    this.upload = options.upload ?? uploadVisionImage
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly getRevision = (): number => this.revision

  list(sessionId: string): readonly VisionDraftImage[] {
    return [...this.records.values()].filter(record => record.sessionId === sessionId)
  }

  add(sessionId: string, id: string, file: File): void {
    if (this.records.has(id)) throw new Error(`duplicate pasted image draft ${id}`)
    const abort = new AbortController()
    const previewUrl = this.createPreview(file)
    let record: VisionDraftRecord
    const source = this.upload(sessionId, file, abort.signal).then((value) => {
      record.status = 'ready'
      this.publish()
      return value
    }).catch((error: unknown) => {
      if (!abort.signal.aborted && this.records.get(id) === record) {
        record.status = 'error'
        record.error = error instanceof Error ? error.message : String(error)
        this.publish()
      }
      throw error
    })
    record = {
      abort,
      id,
      name: file.name || 'Pasted image',
      previewUrl,
      sessionId,
      source,
      status: 'uploading',
    }
    this.records.set(id, record)
    void source.catch(() => {})
    this.publish()
  }

  async serialize(id: string, signal: AbortSignal): Promise<string> {
    const record = this.records.get(id)
    if (record === undefined) throw new Error('Pasted image is no longer available')
    return await Promise.race([record.source, abortPromise(signal)])
  }

  remove(id: string): void {
    const record = this.records.get(id)
    if (record === undefined) return
    this.records.delete(id)
    record.abort.abort(new Error('Pasted image was removed'))
    this.revokePreview(record.previewUrl)
    this.publish()
  }

  prune(sessionId: string, liveIds: ReadonlySet<string>): void {
    for (const record of [...this.records.values()]) {
      if (record.sessionId === sessionId && !liveIds.has(record.id)) this.remove(record.id)
    }
  }

  dispose(): void {
    for (const id of [...this.records.keys()]) this.remove(id)
    this.listeners.clear()
  }

  private publish(): void {
    this.revision += 1
    for (const listener of this.listeners) listener()
  }
}
