/** OpenAI-compatible vision requests and bounded image-source resolution. */

import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

/** Everything needed for one request to a configured vision model. */
export interface VisionRequest {
  apiKey: string
  baseURL: string
  fetch?: typeof fetch
  maxImageBytes: number
  maxTokens: number
  model: string
  question: string
  signal?: AbortSignal
  source: string
  timeoutMs: number
  workspaceRoot?: string
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp',
})

const IMAGE_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION))

/** HTTP failure with a stable status classifier for model fallback. */
export class VisionHttpError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'VisionHttpError'
    this.status = status
  }
}

/** Whether another configured model may recover from this response. */
export function isRetriableVisionError(error: unknown): boolean {
  return error instanceof VisionHttpError
    && (error.status === 404 || error.status === 429 || error.status >= 500)
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

function boundedDataUrl(source: string, maxImageBytes: number): string {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(source)
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error('view_image: data URLs must contain a supported image MIME type and base64 payload')
  }
  const mime = match[1].toLowerCase()
  if (!IMAGE_MIME_TYPES.has(mime)) {
    throw new Error(`view_image: unsupported data URL MIME type ${JSON.stringify(mime)}`)
  }
  const encoded = match[2]
  if (encoded.length > Math.ceil(maxImageBytes * 4 / 3) + 4) {
    throw new Error(`view_image: data URL is over the ${maxImageBytes}-byte limit`)
  }
  const bytes = Buffer.from(encoded, 'base64')
  const normalizedInput = encoded.replace(/=+$/, '')
  const normalizedOutput = bytes.toString('base64').replace(/=+$/, '')
  if (normalizedInput !== normalizedOutput) {
    throw new Error('view_image: data URL contains invalid base64')
  }
  if (bytes.byteLength > maxImageBytes) {
    throw new Error(`view_image: data URL is over the ${maxImageBytes}-byte limit`)
  }
  return source
}

/** Resolve a URL or a workspace-local file to the VLM `image_url` value. */
export async function toImageUrl(
  source: string,
  maxImageBytes: number,
  workspaceRoot?: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted()
  if (/^https?:\/\//i.test(source)) {
    let url: URL
    try {
      url = new URL(source)
    } catch {
      throw new Error(`view_image: invalid image URL: ${source}`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`view_image: unsupported image URL protocol: ${url.protocol}`)
    }
    return source
  }
  if (source.startsWith('data:')) return boundedDataUrl(source, maxImageBytes)
  if (workspaceRoot === undefined || workspaceRoot === '') {
    throw new Error('view_image: local images require an active Session workspace')
  }

  const root = await realpath(workspaceRoot).catch(() => {
    throw new Error(`view_image: Session workspace is unavailable: ${workspaceRoot}`)
  })
  const requested = resolve(root, source)
  const file = await realpath(requested).catch(() => {
    throw new Error(`view_image: file not found: ${source}`)
  })
  if (!isWithin(root, file)) {
    throw new Error(`view_image: local image is outside the active Session workspace: ${source}`)
  }
  const mime = MIME_BY_EXTENSION[extname(requested).toLowerCase()]
  if (mime === undefined) {
    const supported = Object.keys(MIME_BY_EXTENSION).join(' ')
    throw new Error(
      `view_image: unsupported image extension in ${JSON.stringify(source)} `
      + `(supported: ${supported}, or pass an http(s)/data URL)`,
    )
  }
  const info = await stat(file)
  if (!info.isFile()) throw new Error(`view_image: image source is not a file: ${source}`)
  if (info.size > maxImageBytes) {
    throw new Error(
      `view_image: image is ${info.size} bytes, over the ${maxImageBytes}-byte limit `
      + '(raise maxImageBytes in the oh-dsh-vision settings)',
    )
  }
  signal?.throwIfAborted()
  const bytes = await readFile(file, { signal })
  signal?.throwIfAborted()
  return `data:${mime};base64,${bytes.toString('base64')}`
}

function extractText(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return undefined
  const message = (choices[0] as { message?: { content?: unknown } }).message
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const parts = content.flatMap((part) => {
    if (typeof part !== 'object' || part === null) return []
    const text = (part as { text?: unknown }).text
    return typeof text === 'string' && text !== '' ? [text] : []
  })
  return parts.length === 0 ? undefined : parts.join('\n')
}

function stripThinking(text: string): string {
  const closed = text.replace(/<think>[\s\S]*?<\/think>/g, '')
  if (closed !== text) return closed.trim()
  if (/^\s*<think>/.test(text)) return ''
  return text.trim()
}

/** Ask one OpenAI-compatible VLM a question about an image. */
export async function visionChat(request: VisionRequest): Promise<string> {
  const imageUrl = await toImageUrl(
    request.source,
    request.maxImageBytes,
    request.workspaceRoot,
    request.signal,
  )
  const url = `${request.baseURL.replace(/\/+$/, '')}/chat/completions`
  const signals = request.signal === undefined
    ? [AbortSignal.timeout(request.timeoutMs)]
    : [request.signal, AbortSignal.timeout(request.timeoutMs)]
  const redact = (text: string): string => request.apiKey === ''
    ? text
    : text.replaceAll(request.apiKey, '***')

  let response: Response
  try {
    response = await (request.fetch ?? fetch)(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(request.apiKey === '' ? {} : { authorization: `Bearer ${request.apiKey}` }),
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl } },
            { type: 'text', text: request.question },
          ],
        }],
      }),
      signal: AbortSignal.any(signals),
    })
  } catch (error) {
    request.signal?.throwIfAborted()
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(redact(`view_image: request to ${url} failed: ${reason}`))
  }

  const body = await response.text()
  if (!response.ok) {
    throw new VisionHttpError(
      redact(`view_image: ${url} returned ${response.status}: ${body.slice(0, 500)}`),
      response.status,
    )
  }
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    throw new Error(redact(`view_image: ${url} returned non-JSON body: ${body.slice(0, 200)}`))
  }
  const text = extractText(payload)
  if (text === undefined) {
    throw new Error(redact(`view_image: no assistant text in response: ${body.slice(0, 300)}`))
  }
  const cleaned = stripThinking(text)
  if (cleaned === '') {
    throw new Error('view_image: model returned only reasoning and no answer (try raising maxTokens)')
  }
  return cleaned
}
