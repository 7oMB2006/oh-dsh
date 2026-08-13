import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import {
  DEFAULT_SIDEBAR_PREFERENCES,
  parseSidebarPreferences,
  SIDEBAR_PREFERENCES_API_PATH,
  type DesktopSidebarPreferences,
} from './sidebar-preferences.ts'

export interface SidebarDesktopCapability {
  appDataPath: string
}

export interface SidebarPreferencesHostContext {
  webServer: {
    register(route: {
      kind: 'exact'
      path: string
      handler: (
        request: IncomingMessage,
        response: ServerResponse,
      ) => void | Promise<void>
    }): () => void
  }
  logger: { warn(message: string): void }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(value))
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

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 256 * 1024) throw new Error('sidebar preferences are too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

export async function loadSidebarPreferences(
  path: string,
): Promise<DesktopSidebarPreferences> {
  try {
    const value = parseSidebarPreferences(
      JSON.parse(await readFile(path, 'utf8')) as unknown,
    )
    if (value === undefined) throw new Error('sidebar preferences are invalid')
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_SIDEBAR_PREFERENCES
    }
    throw error
  }
}

export async function saveSidebarPreferences(
  path: string,
  preferences: DesktopSidebarPreferences,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.next-${randomBytes(6).toString('hex')}`
  await writeFile(temporary, `${JSON.stringify(preferences, undefined, 2)}\n`, {
    mode: 0o600,
  })
  try {
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

export function mountSidebarPreferences(
  ctx: SidebarPreferencesHostContext,
  desktop: SidebarDesktopCapability,
): () => void {
  if (desktop.appDataPath.length === 0) {
    throw new Error('sidebar: application data path is unavailable')
  }
  const path = join(desktop.appDataPath, 'sidebar.json')
  return ctx.webServer.register({
    kind: 'exact',
    path: SIDEBAR_PREFERENCES_API_PATH,
    handler: async (request, response) => {
      try {
        if (request.method === 'GET') {
          sendJson(response, 200, await loadSidebarPreferences(path))
          return
        }
        if (request.method === 'PUT') {
          if (!sameOrigin(request)) {
            sendJson(response, 403, { error: 'untrusted sidebar origin' })
            return
          }
          const value = parseSidebarPreferences(await readJson(request))
          if (value === undefined) {
            sendJson(response, 400, { error: 'invalid sidebar preferences' })
            return
          }
          await saveSidebarPreferences(path, value)
          sendJson(response, 200, value)
          return
        }
        response.writeHead(405, { allow: 'GET, PUT' })
        response.end()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger.warn(`[sidebar] ${message}`)
        sendJson(response, 500, { error: message })
      }
    },
  })
}
