/** Durable, session-bound indirection from browser paste tokens to DSH attachments. */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  isVisionImageMediaType,
  visionAttachmentSource,
  visionAttachmentToken,
  type VisionAttachmentRef,
} from './protocol.ts'

interface StoredAttachmentReference {
  attachment: VisionAttachmentRef
  sessionId: string
  version: 1
}

function isAttachmentReference(value: unknown): value is VisionAttachmentRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const ref = value as Partial<VisionAttachmentRef>
  return typeof ref.attachmentId === 'string'
    && typeof ref.mediaType === 'string' && isVisionImageMediaType(ref.mediaType)
    && Number.isSafeInteger(ref.bytes) && Number(ref.bytes) >= 0
    && Number.isSafeInteger(ref.width) && Number(ref.width) > 0
    && Number.isSafeInteger(ref.height) && Number(ref.height) > 0
    && (ref.name === undefined || typeof ref.name === 'string')
}

function parseRecord(value: unknown): StoredAttachmentReference | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Partial<StoredAttachmentReference>
  if (record.version !== 1 || typeof record.sessionId !== 'string'
    || !isAttachmentReference(record.attachment)) return undefined
  return record as StoredAttachmentReference
}

/** One-record-per-token store avoids cross-process read/modify/write races. */
export class VisionAttachmentRegistry {
  private readonly directory: string

  constructor(dataRoot: string) {
    if (dataRoot === '') throw new Error('vision attachment registry requires a data root')
    this.directory = join(dataRoot, 'vision', 'attachments')
  }

  async register(sessionId: string, attachment: VisionAttachmentRef): Promise<string> {
    if (sessionId === '') throw new Error('vision attachment registry requires a session id')
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const token = randomUUID()
    const target = join(this.directory, `${token}.json`)
    const temporary = `${target}.next-${String(process.pid)}`
    const record: StoredAttachmentReference = { attachment, sessionId, version: 1 }
    await writeFile(temporary, `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 })
    try {
      await rename(temporary, target)
    } catch (error) {
      await unlink(temporary).catch(() => {})
      throw error
    }
    return visionAttachmentSource(token)
  }

  async resolve(source: string, sessionId: string): Promise<VisionAttachmentRef> {
    const token = visionAttachmentToken(source)
    if (token === undefined) throw new Error('view_image: invalid pasted-image attachment reference')
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(join(this.directory, `${token}.json`), 'utf8')) as unknown
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error('view_image: pasted-image attachment is unavailable')
      }
      throw error
    }
    const record = parseRecord(parsed)
    if (record === undefined) throw new Error('view_image: pasted-image attachment record is invalid')
    if (record.sessionId !== sessionId) {
      throw new Error('view_image: pasted-image attachment belongs to another Session')
    }
    return record.attachment
  }
}
