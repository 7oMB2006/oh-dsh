import { request as httpRequest } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const MARKETPLACE_WEB_PREVIEW_PATH = '/oh-dsh/plugin-marketplace/preview'
export const MARKETPLACE_PREVIEW_QUERY = 'oh-dsh-marketplace-preview'

const HOP_BY_HOP = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

export interface MarketplacePreviewProxyContext {
  webServer: {
    register(route: {
      kind: 'prefix'
      path: string
      handler: (
        request: IncomingMessage,
        response: ServerResponse,
      ) => void | Promise<void>
    }): () => void
  }
}

function forwardedHeaders(request: IncomingMessage): NodeJS.Dict<string | string[]> {
  const headers: NodeJS.Dict<string | string[]> = {}
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    const lower = name.toLowerCase()
    if (HOP_BY_HOP.has(lower)) continue
    headers[lower] = value
  }
  return headers
}

/**
 * Publish loopback preview runtimes through the outer Web origin. Remote
 * browsers behind the supported LAN/reverse-proxy deployment cannot reach
 * the preview child's 127.0.0.1 URL; this prefix route proxies preview
 * traffic through the live web server that the browser already trusts.
 */
export class MarketplacePreviewProxy {
  readonly #targets = new Map<string, URL>()

  register(transactionId: string, target: URL): string {
    this.#targets.set(transactionId, new URL(target.href))
    return `${MARKETPLACE_WEB_PREVIEW_PATH}/${encodeURIComponent(transactionId)}/?${MARKETPLACE_PREVIEW_QUERY}=1`
  }

  unregister(transactionId: string): void {
    this.#targets.delete(transactionId)
  }

  mount(ctx: MarketplacePreviewProxyContext): () => void {
    return ctx.webServer.register({
      kind: 'prefix',
      path: MARKETPLACE_WEB_PREVIEW_PATH,
      handler: (request, response) => {
        void this.handle(request, response)
      },
    })
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const requestUrl = new URL(request.url ?? '/', 'http://oh-dsh-preview.internal')
    const remainder = requestUrl.pathname.startsWith(`${MARKETPLACE_WEB_PREVIEW_PATH}/`)
      ? requestUrl.pathname.slice(MARKETPLACE_WEB_PREVIEW_PATH.length)
      : '/'
    const segments = remainder.split('/').filter(Boolean)
    const encodedTransaction = segments[0]
    if (encodedTransaction === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    let transactionId: string
    try {
      transactionId = decodeURIComponent(encodedTransaction)
    } catch {
      response.writeHead(400)
      response.end()
      return
    }
    const target = this.#targets.get(transactionId)
    if (target === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    const rawPath = remainder.indexOf('/', 1) < 0
      ? '/'
      : remainder.slice(remainder.indexOf('/', 1))
    const upstreamUrl = new URL(rawPath, target.origin)
    upstreamUrl.search = requestUrl.search

    const upstream = httpRequest(upstreamUrl, {
      headers: forwardedHeaders(request),
      method: request.method,
    }, upstreamResponse => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        forwardedHeaders(upstreamResponse as unknown as IncomingMessage),
      )
      upstreamResponse.pipe(response)
    })
    upstream.once('error', error => {
      if (response.headersSent) {
        response.destroy(error)
        return
      }
      response.writeHead(502)
      response.end()
    })
    request.once('error', () => {
      upstream.destroy()
    })
    request.pipe(upstream)
  }
}
