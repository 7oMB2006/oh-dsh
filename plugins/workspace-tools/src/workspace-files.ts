import { open, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { WorkspaceFileEntry, WorkspaceFilesResponse } from './protocol.ts'
import { normalizeWorkspacePath } from './git-workspace.ts'

const MAX_ENTRIES = 300
const MAX_PREVIEW_BYTES = 256 * 1024

function inside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

async function resolveTarget(rawCwd: string | undefined, rawPath: string | undefined): Promise<{ cwd: string; target: string }> {
  const cwd = await realpath(normalizeWorkspacePath(rawCwd))
  const requested = rawPath?.trim()
  if (requested !== undefined && (requested === '' || requested.length > 4096 || requested.includes('\0'))) {
    throw new Error('invalid workspace file path')
  }
  const candidate = requested === undefined
    ? cwd
    : isAbsolute(requested) ? resolve(requested) : resolve(cwd, requested)
  const target = await realpath(candidate)
  if (!inside(cwd, target)) throw new Error('workspace file path escapes the workspace')
  return { cwd, target }
}

async function directoryEntry(path: string, name: string, kind: WorkspaceFileEntry['kind']): Promise<WorkspaceFileEntry> {
  if (kind === 'directory') return { kind, name, path, size: null }
  try {
    const details = await stat(path)
    return { kind, name, path, size: details.isFile() ? details.size : null }
  } catch {
    return { kind, name, path, size: null }
  }
}

async function previewFile(cwd: string, target: string, size: number): Promise<WorkspaceFilesResponse> {
  const length = Math.min(size, MAX_PREVIEW_BYTES)
  const buffer = Buffer.alloc(length)
  const handle = await open(target, 'r')
  let bytesRead = 0
  try {
    if (length > 0) ({ bytesRead } = await handle.read(buffer, 0, length, 0))
  } finally {
    await handle.close()
  }
  const body = buffer.subarray(0, bytesRead)
  const binary = body.includes(0)
  return {
    kind: 'file',
    cwd,
    path: target,
    parent: dirname(target),
    content: binary ? null : body.toString('utf8'),
    binary,
    size,
    truncated: size > bytesRead,
  }
}

/** Read one bounded directory level or a bounded textual file preview inside a workspace. */
export async function readWorkspaceFiles(
  rawCwd: string | undefined,
  rawPath: string | undefined,
): Promise<WorkspaceFilesResponse> {
  const { cwd, target } = await resolveTarget(rawCwd, rawPath)
  const details = await stat(target)
  if (details.isFile()) return await previewFile(cwd, target, details.size)
  if (!details.isDirectory()) throw new Error('workspace path is not a regular file or directory')

  const children = (await readdir(target, { withFileTypes: true }))
    .sort((left, right) => {
      const leftDirectory = left.isDirectory() ? 0 : 1
      const rightDirectory = right.isDirectory() ? 0 : 1
      return leftDirectory - rightDirectory || left.name.localeCompare(right.name)
    })
  const visible = children.slice(0, MAX_ENTRIES)
  const entries = await Promise.all(visible.map(async child => {
    const kind: WorkspaceFileEntry['kind'] = child.isDirectory()
      ? 'directory'
      : child.isFile() ? 'file' : 'symlink'
    return await directoryEntry(join(target, child.name), child.name, kind)
  }))
  return {
    kind: 'directory',
    cwd,
    path: target,
    parent: target === cwd ? null : dirname(target),
    entries,
    truncated: children.length > visible.length,
  }
}
