import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WorkspaceMutation } from './protocol.ts'
import { FILES_API_PATH, WORKSPACE_API_PATH } from './protocol.ts'
import { mutateWorkspace, readWorkspaceDiff, readWorkspaceSnapshot } from './git-workspace.ts'
import { readWorkspaceFiles } from './workspace-files.ts'

interface HostContext {
  effect(effect: () => (() => void) | void, label?: string): void
  httpServer: {
    register(route: {
      kind: 'exact'
      path: string
      handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
    }): () => void
  }
  logger: {
    warn(message: string): void
  }
}

export const name = 'oh-dsh-workspace-tools'
export const inject = ['httpServer']

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

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 32 * 1024) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function isMutation(value: unknown): value is WorkspaceMutation {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  if (input.action === 'push') return true
  if (input.action === 'checkout' || input.action === 'create-branch') return typeof input.branch === 'string'
  return input.action === 'commit' && typeof input.message === 'string'
}

export function apply(ctx: HostContext): void {
  ctx.effect(() => ctx.httpServer.register({
    kind: 'exact',
    path: WORKSPACE_API_PATH,
    handler: async (request, response) => {
      try {
        const url = new URL(request.url ?? '/', 'http://oh-dsh.internal')
        const cwd = url.searchParams.get('cwd') ?? undefined
        if (request.method === 'GET') {
          const diffPath = url.searchParams.get('diff')
          if (diffPath !== null) {
            sendJson(response, 200, { diff: await readWorkspaceDiff(cwd, diffPath) })
          } else {
            sendJson(response, 200, await readWorkspaceSnapshot(cwd))
          }
          return
        }
        if (request.method === 'POST') {
          if (!sameOrigin(request)) {
            sendJson(response, 403, { error: 'untrusted workspace mutation origin' })
            return
          }
          const mutation = await readJsonBody(request)
          if (!isMutation(mutation)) throw new Error('invalid workspace mutation')
          sendJson(response, 200, await mutateWorkspace(cwd, mutation))
          return
        }
        response.writeHead(405, { allow: 'GET, POST' })
        response.end()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger.warn(`[workspace-tools] ${message}`)
        sendJson(response, 400, { error: message })
      }
    },
  }), 'oh-dsh-desktop: workspace Git API')
  ctx.effect(() => ctx.httpServer.register({
    kind: 'exact',
    path: FILES_API_PATH,
    handler: async (request, response) => {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET' })
        response.end()
        return
      }
      try {
        const url = new URL(request.url ?? '/', 'http://oh-dsh.internal')
        sendJson(response, 200, await readWorkspaceFiles(
          url.searchParams.get('cwd') ?? undefined,
          url.searchParams.get('path') ?? undefined,
        ))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger.warn(`[workspace-files] ${message}`)
        sendJson(response, 400, { error: message })
      }
    },
  }), 'oh-dsh-desktop: workspace files API')
}
