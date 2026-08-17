import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { acquireRuntimeLock } from '../src/runtime-lock.ts'

const LOCK_FILE = '.runtime.lock'

test('acquireRuntimeLock creates a lock and release removes it', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-lock-'))
  try {
    const lock = acquireRuntimeLock(root, 'web')
    const path = join(root, LOCK_FILE)
    assert.equal(existsSync(path), true)
    const info = JSON.parse(readFileSync(path, 'utf8')) as { pid: number; surface: string }
    assert.equal(info.pid, process.pid)
    assert.equal(info.surface, 'web')

    lock.release()
    assert.equal(existsSync(path), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('acquireRuntimeLock rejects a second live surface on the same root', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-lock-'))
  try {
    const first = acquireRuntimeLock(root, 'desktop')
    try {
      assert.throws(
        () => acquireRuntimeLock(root, 'web'),
        /still using/,
      )
    } finally {
      first.release()
    }

    const second = acquireRuntimeLock(root, 'web')
    second.release()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('acquireRuntimeLock replaces a stale lock left by a dead process', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-lock-'))
  try {
    const path = join(root, LOCK_FILE)
    writeFileSync(path, JSON.stringify({
      pid: 2_147_483_647,
      surface: 'old-surface',
      startedAt: 1,
    }))

    const lock = acquireRuntimeLock(root, 'tui')
    const info = JSON.parse(readFileSync(path, 'utf8')) as { pid: number; surface: string }
    assert.equal(info.pid, process.pid)
    assert.equal(info.surface, 'tui')
    lock.release()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release does not delete a lock owned by a different process', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-lock-'))
  try {
    const first = acquireRuntimeLock(root, 'desktop')
    const path = join(root, LOCK_FILE)
    writeFileSync(path, JSON.stringify({
      pid: process.pid + 1,
      surface: 'web',
      startedAt: 2,
    }))

    first.release()
    assert.equal(existsSync(path), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('setChildPids records runtime children in the lock', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-lock-'))
  try {
    const lock = acquireRuntimeLock(root, 'web')
    lock.setChildPids([process.pid])
    const path = join(root, LOCK_FILE)
    const info = JSON.parse(readFileSync(path, 'utf8')) as { childPids?: number[] }
    assert.deepEqual(info.childPids, [process.pid])
    lock.release()
    assert.equal(existsSync(path), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('acquireRuntimeLock refuses a stale owner with a live child process', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-lock-'))
  try {
    const path = join(root, LOCK_FILE)
    writeFileSync(path, JSON.stringify({
      pid: 2_147_483_647,
      surface: 'old-surface',
      startedAt: 1,
      childPids: [process.pid],
    }))

    assert.throws(
      () => acquireRuntimeLock(root, 'web'),
      /still using/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('acquireRuntimeLock replaces a stale owner whose child is also dead', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-lock-'))
  try {
    const path = join(root, LOCK_FILE)
    writeFileSync(path, JSON.stringify({
      pid: 2_147_483_647,
      surface: 'old-surface',
      startedAt: 1,
      childPids: [2_147_483_646],
    }))

    const lock = acquireRuntimeLock(root, 'tui')
    const info = JSON.parse(readFileSync(path, 'utf8')) as { pid: number; surface: string }
    assert.equal(info.pid, process.pid)
    assert.equal(info.surface, 'tui')
    lock.release()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
