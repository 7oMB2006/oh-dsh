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

import { spawnSync } from 'node:child_process'
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'
import { UsageError } from './errors.ts'

/** Thrown when another live Oh-DSH surface already owns the data root. */
export class RuntimeLockContendedError extends UsageError {}

/** Metadata stored in the data-root lock file. */
export interface RuntimeLockInfo {
  pid: number
  surface: string
  startedAt: number
  processStart?: string
  childPids?: number[]
  childStarts?: string[]
}

/** An acquired data-root lock. */
export interface RuntimeLock {
  readonly path: string
  /** Replace the tracked DSH runtime child PIDs for this ownership. */
  setChildPids(pids: readonly number[]): void
  /** Remove the lock if it is still owned by this process. */
  release(): void
}

const LOCK_FILE_NAME = '.runtime.lock'
const MAX_RECLAIM_WAIT_ATTEMPTS = 250

interface ReclaimLockInfo {
  pid: number
  processStart?: string
  startedAt: number
}

function readReclaimInfo(path: string): ReclaimLockInfo | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { pid, processStart, startedAt } = parsed as Record<string, unknown>
    if (typeof pid !== 'number' || Number.isSafeInteger(pid) === false || pid <= 0) return undefined
    if (processStart !== undefined && typeof processStart !== 'string') return undefined
    if (typeof startedAt !== 'number' || Number.isFinite(startedAt) === false) return undefined
    return {
      pid,
      ...(processStart === undefined ? {} : { processStart }),
      startedAt,
    }
  } catch {
    return undefined
  }
}

function readLockInfo(path: string): RuntimeLockInfo | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { pid, surface, startedAt, processStart, childPids, childStarts } =
      parsed as Record<string, unknown>
    if (typeof pid !== 'number' || Number.isSafeInteger(pid) === false || pid <= 0) return undefined
    if (typeof surface !== 'string' || surface === '') return undefined
    if (typeof startedAt !== 'number' || Number.isFinite(startedAt) === false) return undefined
    if (processStart !== undefined && typeof processStart !== 'string') return undefined
    if (childPids !== undefined) {
      if (Array.isArray(childPids) === false) return undefined
      if (childPids.some(value => typeof value !== 'number'
        || Number.isSafeInteger(value) === false || value <= 0)) return undefined
    }
    if (childStarts !== undefined) {
      if (Array.isArray(childStarts) === false) return undefined
      if (childStarts.some(value => typeof value !== 'string')) return undefined
    }
    if (childPids !== undefined && childStarts !== undefined
      && childStarts.length !== childPids.length) return undefined
    return {
      pid,
      surface,
      startedAt,
      ...(processStart === undefined ? {} : { processStart }),
      ...(childPids === undefined ? {} : { childPids: [...childPids] }),
      ...(childStarts === undefined ? {} : { childStarts: [...childStarts] }),
    }
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
 * Read a stable process-start marker for a PID. On POSIX systems `ps` exposes
 * `lstart`, which lets us distinguish a reused PID from the original owner.
 * Returns `undefined` when the platform cannot provide the marker; callers
 * then fall back to PID-existence checks.
 */
function readProcessStart(pid: number): string | undefined {
  try {
    const result = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8',
      timeout: 2_000,
      env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' },
    })
    if (result.status !== 0) return undefined
    const value = result.stdout.trim()
    return value === '' ? undefined : value
  } catch {
    return undefined
  }
}

function pidMatchesStoredIdentity(pid: number, expectedStart: string | undefined): boolean {
  if (isProcessAlive(pid) === false) return false
  if (expectedStart === undefined || expectedStart === '') return true
  const actualStart = readProcessStart(pid)
  return actualStart === undefined || actualStart === expectedStart
}

function hasLiveOwner(info: RuntimeLockInfo): boolean {
  if (pidMatchesStoredIdentity(info.pid, info.processStart)) return true
  const childPids = info.childPids ?? []
  const childStarts = info.childStarts ?? []
  return childPids.some((pid, index) => pidMatchesStoredIdentity(pid, childStarts[index]))
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
    + `or its DSH runtime is still using ${dataRoot}. Stop it first, or `
    + 'choose a separate data root with --data/OH_DSH_HOME.'
}

function writeLockInfo(path: string, info: RuntimeLockInfo): void {
  writeFileSync(path, JSON.stringify(info), { mode: 0o600 })
}

function sleepSync(milliseconds: number): void {
  const buffer = new SharedArrayBuffer(4)
  const view = new Int32Array(buffer)
  Atomics.wait(view, 0, 0, milliseconds)
}

/**
 * Acquire an exclusive lock for one Oh-DSH surface on a shared data root.
 *
 * The lock is a small JSON file created with `wx`, so concurrent acquisitions
 * cannot clobber each other. A lock whose owning PID and tracked runtime child
 * PIDs are no longer alive is considered stale and is replaced. Stale
 * reclamation is serialized by a separate reclaim lock so concurrent
 * reclaimers cannot delete a freshly created live lock.
 */
export function acquireRuntimeLock(dataRoot: string, surface: string): RuntimeLock {
  mkdirSync(dataRoot, { recursive: true, mode: 0o700 })
  const path = join(dataRoot, LOCK_FILE_NAME)
  const reclaimPath = `${path}.reclaim`

  for (let attempt = 0; attempt < MAX_RECLAIM_WAIT_ATTEMPTS; attempt += 1) {
    let handle: number | undefined
    try {
      handle = openSync(path, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const info = readLockInfo(path)
      if (info !== undefined && hasLiveOwner(info)) {
        throw new RuntimeLockContendedError(lockOwnerMessage(info, dataRoot))
      }
      if (info === undefined && isStaleLockFile(path) === false) {
        throw new UsageError(
          `runtime lock at ${path} is being acquired or unreadable; `
          + 'remove it manually if no other Oh-DSH surface is running',
        )
      }
      // The lock is absent, left by a dead process and dead children, or old
      // enough to be a stale unparsable file. Serialize recovery with a
      // separate reclaim lock: only one reclaimer can hold it, and it re-reads
      // the main lock after acquiring it so a fresh live lock is never moved.
      let reclaimHandle: number | undefined
      try {
        reclaimHandle = openSync(reclaimPath, 'wx', 0o600)
      } catch (reclaimError) {
        if ((reclaimError as NodeJS.ErrnoException).code !== 'EEXIST') throw reclaimError
        const reclaimInfo = readReclaimInfo(reclaimPath)
        if (reclaimInfo !== undefined
          && pidMatchesStoredIdentity(reclaimInfo.pid, reclaimInfo.processStart)) {
          // The original reclaimer is still alive; wait for it to finish.
          sleepSync(20)
          continue
        }
        if (isStaleLockFile(reclaimPath)) {
          // Without an atomic compare-and-swap we must not auto-remove a
          // reclaim mutex; a delayed reclaimer could delete a fresh one.
          throw new UsageError(
            `stale runtime reclaim lock at ${reclaimPath} exists; `
            + 'remove it manually if no other Oh-DSH surface is recovering',
          )
        }
        sleepSync(20)
        continue
      }
      const reclaimInfo: ReclaimLockInfo = {
        pid: process.pid,
        startedAt: Date.now(),
      }
      // Publish ownership before probing the start marker. If this process is
      // killed during the probe, contenders still see a live reclaimer.
      writeSync(reclaimHandle, JSON.stringify(reclaimInfo))
      const reclaimProcessStart = readProcessStart(process.pid)
      const enrichedReclaim = readReclaimInfo(reclaimPath)
      if (enrichedReclaim?.pid === process.pid) {
        writeFileSync(reclaimPath, JSON.stringify({
          ...enrichedReclaim,
          ...(reclaimProcessStart === undefined ? {} : { processStart: reclaimProcessStart }),
        }), { mode: 0o600 })
      }
      try {
        const current = readLockInfo(path)
        if (current !== undefined && hasLiveOwner(current)) {
          throw new RuntimeLockContendedError(lockOwnerMessage(current, dataRoot))
        }
        if (current === undefined && isStaleLockFile(path) === false) {
          throw new UsageError(
            `runtime lock at ${path} is being acquired or unreadable; `
            + 'remove it manually if no other Oh-DSH surface is running',
          )
        }
        try {
          unlinkSync(path)
        } catch (unlinkError) {
          if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError
        }
      } finally {
        closeSync(reclaimHandle)
        try {
          unlinkSync(reclaimPath)
        } catch {
          // Best-effort cleanup of the reclaim lock.
        }
      }
      continue
    }

    const processStart = readProcessStart(process.pid)
    const info: RuntimeLockInfo = {
      pid: process.pid,
      surface,
      startedAt: Date.now(),
      ...(processStart === undefined ? {} : { processStart }),
    }
    try {
      writeSync(handle, JSON.stringify(info))
    } finally {
      closeSync(handle)
    }

    return {
      path,
      setChildPids: (childPids: readonly number[]) => {
        try {
          const current = readLockInfo(path)
          if (current?.pid !== process.pid) return
          // Publish child PIDs before probing their start markers. If this
          // process dies during the probe, contenders still see the live
          // child and cannot reclaim the lock beside an orphan.
          writeLockInfo(path, {
            ...current,
            childPids: [...childPids],
          })
          const childStarts = childPids.map(pid => readProcessStart(pid) ?? '')
          const enriched = readLockInfo(path)
          if (enriched?.pid === process.pid) {
            writeLockInfo(path, {
              ...enriched,
              childPids: [...childPids],
              childStarts,
            })
          }
        } catch {
          // Best-effort update: if the lock disappeared or was replaced, the
          // owning process is no longer authoritative.
        }
      },
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

/**
 * Try to acquire the data-root lock. If another surface already owns it,
 * return a read-only result instead of throwing, so the caller can start a
 * viewer that may read shared history but must not write to active sessions.
 */
export function tryAcquireRuntimeLock(
  dataRoot: string,
  surface: string,
): { lock: RuntimeLock | undefined; readOnly: boolean } {
  try {
    return { lock: acquireRuntimeLock(dataRoot, surface), readOnly: false }
  } catch (error) {
    if (error instanceof RuntimeLockContendedError) {
      return { lock: undefined, readOnly: true }
    }
    throw error
  }
}
