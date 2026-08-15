/** Same-origin browser upload endpoint backed by DSH's attachment store. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename } from 'node:path'
import {
  isVisionImageMediaType,
  VISION_ATTACHMENT_API_PATH,
  type VisionAttachmentRef,
  type VisionAttachmentUpload,
  type VisionImageMediaType,
} from './protocol.ts'
import type { VisionAttachmentRegistry } from './attachment-registry.ts'

interface VisionAttachmentHostContext {
  agents: { get(id: never): unknown }
  attachments: {
    saveImage(input: {
      data: Uint8Array
      mediaType: VisionImageMediaType
      name?: string
    }): Promise<VisionAttachmentRef>
  }
  logger: { warn(message: string): void }
  webServer: {
    register(route: {
      kind: 'exact'
      path: string
      handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
    }): () => void
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

async function readJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('pasted image upload is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

export function decodeVisionAttachmentUpload(value: unknown, maxImageBytes: number): {
  data: Uint8Array
  mediaType: VisionImageMediaType
  name?: string
  sessionId: string
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid pasted image upload')
  }
  const upload = value as Partial<VisionAttachmentUpload>
  if (typeof upload.sessionId !== 'string' || upload.sessionId.length === 0
    || upload.sessionId.length > 256) throw new Error('invalid pasted image Session')
  if (typeof upload.mediaType !== 'string' || !isVisionImageMediaType(upload.mediaType)) {
    throw new Error('unsupported pasted image format')
  }
  if (typeof upload.data !== 'string' || upload.data.length === 0
    || upload.data.length > Math.ceil(maxImageBytes * 4 / 3) + 4) {
    throw new Error(`pasted image exceeds the ${String(maxImageBytes)}-byte limit`)
  }
  const data = Buffer.from(upload.data, 'base64')
  if (data.toString('base64') !== upload.data || data.byteLength > maxImageBytes) {
    throw new Error('pasted image data is invalid or too large')
  }
  const rawName = typeof upload.name === 'string' && upload.name !== ''
    ? basename(upload.name.replaceAll('\\', '/')).slice(0, 255)
    : undefined
  return {
    data: new Uint8Array(data),
    mediaType: upload.mediaType,
    sessionId: upload.sessionId,
    ...(rawName === undefined ? {} : { name: rawName }),
  }
}

export function mountVisionAttachmentServer(
  ctx: VisionAttachmentHostContext,
  registry: VisionAttachmentRegistry,
  maxImageBytes: () => number,
): () => void {
  return ctx.webServer.register({
    kind: 'exact',
    path: VISION_ATTACHMENT_API_PATH,
    handler: async (request, response) => {
      try {
        if (request.method !== 'POST') {
          response.writeHead(405, { allow: 'POST' })
          response.end()
          return
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: 'untrusted pasted image origin' })
          return
        }
        const limit = maxImageBytes()
        const upload = decodeVisionAttachmentUpload(
          await readJson(request, Math.ceil(limit * 4 / 3) + 64 * 1024),
          limit,
        )
        if (ctx.agents.get(upload.sessionId as never) === undefined) {
          sendJson(response, 404, { error: 'pasted image Session is not active' })
          return
        }
        const attachment = await ctx.attachments.saveImage({
          data: upload.data,
          mediaType: upload.mediaType,
          ...(upload.name === undefined ? {} : { name: upload.name }),
        })
        sendJson(response, 200, {
          source: await registry.register(upload.sessionId, attachment),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger.warn(`[vision] ${message}`)
        sendJson(response, 400, { error: message })
      }
    },
  })
}
