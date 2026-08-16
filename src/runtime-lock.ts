/**
 * Cross-surface runtime lock for a shared Oh-DSH data root.
 *
 * Desktop, Web, and TUI each launch their own DSH runtime process. The DSH
 * session persistence contract allows only one live writer per session, and
 * the JSONL backend explicitly does not coordinate writers across processes.
 * This lock prevents two Oh-DSH surfaces from using the same data root at the
 * same time, which would otherwise let two runtimes append to the same session
 * log and create sequence gaps that make history unreadable.
 *
 * @module oh-dsh/runtime-lock
 */

import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'
import { UsageError } from './errors.ts'

/** Metadata stored in the data-root lock file. */
export interface RuntimeLockInfo {
  pid: number
  surface: string
  startedAt: number
}

/** An acquired data-root lock. */
export interface RuntimeLock {
  readonly path: string
  /** Remove the lock if it is still owned by this process. */
  release(): void
}

const LOCK_FILE_NAME = '.runtime.lock'

function readLockInfo(path: string): RuntimeLockInfo | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { pid, surface, startedAt } = parsed as Record<string, unknown>
    if (typeof pid !== 'number' || Number.isSafeInteger(pid) === false || pid <= 0) return undefined
    if (typeof surface !== 'string' || surface === '') return undefined
    if (typeof startedAt !== 'number' || Number.isFinite(startedAt) === false) return undefined
    return { pid, surface, startedAt }
  } catch {
    return undefined
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but is owned by another user; treat it as
    // alive so we never steal a live lock we cannot inspect.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * A lock file that cannot be parsed is only safe to replace after a grace
 * period. The window between `open('wx')` and the first `writeSync` is tiny,
 * but removing a fresh unparsable lock could let two surfaces acquire the same
 * root during that race.
 */
function isStaleLockFile(path: string): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs > 10_000
  } catch {
    return false
  }
}

function lockOwnerMessage(info: RuntimeLockInfo, dataRoot: string): string {
  return `Another Oh-DSH surface (${info.surface}, pid ${String(info.pid)}) `
    + `is already using ${dataRoot}. Stop it first, or choose a separate data `
    + 'root with --data/OH_DSH_HOME.'
}

/**
 * Acquire an exclusive lock for one Oh-DSH surface on a shared data root.
 *
 * The lock is a small JSON file created with `wx`, so concurrent acquisitions
 * cannot clobber each other. A lock whose owning PID is no longer alive is
 * considered stale and is replaced.
 */
export function acquireRuntimeLock(dataRoot: string, surface: string): RuntimeLock {
  mkdirSync(dataRoot, { recursive: true, mode: 0o700 })
  const path = join(dataRoot, LOCK_FILE_NAME)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let handle: number | undefined
    try {
      handle = openSync(path, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const info = readLockInfo(path)
      if (info !== undefined && isProcessAlive(info.pid)) {
        throw new UsageError(lockOwnerMessage(info, dataRoot))
      }
      if (info === undefined && !isStaleLockFile(path)) {
        throw new UsageError(
          `runtime lock at ${path} is being acquired or unreadable; `
          + 'remove it manually if no other Oh-DSH surface is running',
        )
      }
      // The lock is absent, left by a dead process, or old enough to be a
      // stale unparsable file. Remove it and retry so a fresh writer can take
      // ownership.
      try {
        unlinkSync(path)
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError
      }
      continue
    }

    const info: RuntimeLockInfo = {
      pid: process.pid,
      surface,
      startedAt: Date.now(),
    }
    try {
      writeSync(handle, JSON.stringify(info))
    } finally {
      closeSync(handle)
    }

    return {
      path,
      release: () => {
        try {
          const current = readLockInfo(path)
          if (current?.pid === process.pid) unlinkSync(path)
        } catch {
          // Best-effort cleanup: a missing or already-replaced lock is fine.
        }
      },
    }
  }

  throw new UsageError(`unable to acquire runtime lock at ${path}`)
}
