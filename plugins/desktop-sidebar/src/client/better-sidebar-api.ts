import type { WorkspaceFilesResponse } from '../protocol.ts'

export interface BetterSidebarScope {
  sessionId: string
  cwd?: string
}

export interface BetterSidebarFsEntry {
  hidden: boolean
  isDir: boolean
  name: string
  path: string
}

export interface BetterSidebarFsTree {
  entries: BetterSidebarFsEntry[]
  path: string
  truncated: boolean
}

export type BetterSidebarFsRead = {
  kind: 'text'
  content: string
  truncated: boolean
} | {
  kind: 'binary'
  head?: string
  size: number
  truncated: boolean
}

interface BetterSidebarEnvelope<T> {
  error?: { code?: string; message?: string }
  ok?: boolean
  value?: T
}

function scopePayload(
  scope: BetterSidebarScope,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    sessionId: scope.sessionId,
    ...(scope.cwd === undefined || scope.cwd === '' ? {} : { cwd: scope.cwd }),
    ...extra,
  }
}

async function call<T>(
  method: string,
  scope: BetterSidebarScope,
  extra: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/sidebar/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(scopePayload(scope, extra)),
    ...(signal === undefined ? {} : { signal }),
  })
  const envelope = await response.json() as BetterSidebarEnvelope<T>
  if (!response.ok || envelope.ok !== true || envelope.value === undefined) {
    throw new Error(envelope.error?.message ?? `HTTP ${String(response.status)}`)
  }
  return envelope.value
}

export const betterSidebarApi = {
  fsRead: (
    scope: BetterSidebarScope,
    path: string,
    signal?: AbortSignal,
  ): Promise<BetterSidebarFsRead> => call('fs.read', scope, { path }, signal),
  fsTree: (
    scope: BetterSidebarScope,
    path: string,
    signal?: AbortSignal,
  ): Promise<BetterSidebarFsTree> => call('fs.tree', scope, { path }, signal),
}

function normalizedPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/$/, '')
}

function workspaceParent(cwd: string, path: string): string | null {
  const root = normalizedPath(cwd)
  const current = normalizedPath(path)
  if (current === root || !current.startsWith(`${root}/`)) return null
  const parent = current.slice(0, current.lastIndexOf('/'))
  return parent.length >= root.length ? parent : null
}

export function mapBetterSidebarTree(
  cwd: string,
  listing: BetterSidebarFsTree,
): WorkspaceFilesResponse {
  return {
    kind: 'directory',
    cwd,
    path: listing.path,
    parent: workspaceParent(cwd, listing.path),
    entries: listing.entries.map(entry => ({
      kind: entry.isDir ? 'directory' : 'file',
      name: entry.name,
      path: entry.path,
      size: null,
    })),
    truncated: listing.truncated,
  }
}

export function mapBetterSidebarFile(
  cwd: string,
  path: string,
  result: BetterSidebarFsRead,
): WorkspaceFilesResponse {
  if (result.kind === 'binary') {
    return {
      kind: 'file',
      cwd,
      path,
      parent: workspaceParent(cwd, path) ?? cwd,
      content: null,
      binary: true,
      size: result.size,
      truncated: result.truncated,
    }
  }
  return {
    kind: 'file',
    cwd,
    path,
    parent: workspaceParent(cwd, path) ?? cwd,
    content: result.content,
    binary: false,
    size: new TextEncoder().encode(result.content).byteLength,
    truncated: result.truncated,
  }
}
