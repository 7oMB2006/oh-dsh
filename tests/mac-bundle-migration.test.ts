import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import {
  compareVersions,
  findStaleMacBundles,
  retireStaleMacBundles,
  type BundleProbe,
} from '../src/mac-bundle-migration.ts'

function makeProbe(metadata: Record<string, { identifier?: string | null; version?: string | null }>): BundleProbe {
  return {
    bundleIdentifier: async path => metadata[path]?.identifier ?? null,
    shortVersion: async path => metadata[path]?.version ?? null,
  }
}

test('compareVersions orders dotted versions numerically', () => {
  assert.equal(compareVersions('0.1.3', '0.1.4'), -1)
  assert.equal(compareVersions('0.1.9', '0.1.10'), -1)
  assert.equal(compareVersions('0.2.0', '0.1.99'), 1)
  assert.equal(compareVersions('1.0.0', '1'), 0)
  assert.equal(compareVersions('0.1.5', '0.1.5'), 0)
  assert.equal(compareVersions('0.0.0', '0.1.0'), -1)
})

test('findStaleMacBundles returns only older siblings with the same bundle identifier', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-stale-'))
  try {
    const applications = join(root, 'Applications')
    const running = join(applications, 'Oh-DSH Desktop.app')
    const old = join(applications, 'Oh-DSH-Desktop.app')
    const unrelated = join(applications, 'Unrelated.app')
    const newer = join(applications, 'Oh-DSH-Newer.app')
    for (const bundle of [running, old, unrelated, newer]) {
      mkdirSync(bundle, { recursive: true })
    }
    const probe = makeProbe({
      [old]: { identifier: 'ai.deepseek.oh-dsh-desktop', version: '0.1.3' },
      [running]: { identifier: 'ai.deepseek.oh-dsh-desktop', version: '0.1.5' },
      [unrelated]: { identifier: 'com.example.other', version: '0.1.3' },
      [newer]: { identifier: 'ai.deepseek.oh-dsh-desktop', version: '0.2.0' },
    })

    const result = await findStaleMacBundles({
      applicationsDir: applications,
      runningBundlePath: running,
      runningVersion: '0.1.5',
      bundleNames: ['Oh-DSH-Desktop.app', 'Oh-DSH Desktop.app', 'Oh-DSH-Newer.app'],
      probe,
    })

    assert.deepEqual(result, {
      stale: [{ path: old, version: '0.1.3' }],
      unverifiable: [],
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('findStaleMacBundles ignores bundles that do not exist', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-missing-'))
  try {
    const result = await findStaleMacBundles({
      applicationsDir: join(root, 'Applications'),
      runningBundlePath: join(root, 'Applications', 'Oh-DSH Desktop.app'),
      runningVersion: '0.1.5',
      probe: makeProbe({}),
    })
    assert.deepEqual(result, { stale: [], unverifiable: [] })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('findStaleMacBundles never treats an unreadable version as older', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-unverified-'))
  try {
    const applications = join(root, 'Applications')
    const running = join(applications, 'Oh-DSH Desktop.app')
    const unknown = join(applications, 'Oh-DSH-Desktop.app')
    mkdirSync(unknown, { recursive: true })
    const probe = makeProbe({
      [unknown]: { identifier: 'ai.deepseek.oh-dsh-desktop', version: null },
    })

    const result = await findStaleMacBundles({
      applicationsDir: applications,
      runningBundlePath: running,
      runningVersion: '0.1.5',
      probe,
    })

    assert.deepEqual(result, { stale: [], unverifiable: [unknown] })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('retireStaleMacBundles moves older siblings to the Trash and re-registers the running bundle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-retire-'))
  try {
    const applications = join(root, 'Applications')
    const trash = join(root, 'Trash')
    const running = join(applications, 'Oh-DSH Desktop.app')
    const old = join(applications, 'Oh-DSH-Desktop.app')
    mkdirSync(join(old, 'Contents'), { recursive: true })
    writeFileSync(join(old, 'Contents', 'Info.plist'), '<plist/>')
    const probe = makeProbe({
      [old]: { identifier: 'ai.deepseek.oh-dsh-desktop', version: '0.1.3' },
    })

    const result = await retireStaleMacBundles({
      applicationsDir: applications,
      trashDirectory: trash,
      runningBundlePath: running,
      runningVersion: '0.1.5',
      probe,
    })

    assert.equal(result.failures.length, 0)
    assert.equal(result.retired.length, 1)
    assert.equal(result.retired[0]!.path, old)
    assert.equal(result.retired[0]!.version, '0.1.3')
    assert.equal(existsSync(old), false)
    assert.equal(existsSync(result.retired[0]!.trashPath), true)
    assert.match(result.retired[0]!.trashPath, /Oh-DSH-Desktop-before-\d{8}-\d{6}(-\d+)?\.app$/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('retireStaleMacBundles leaves unverifiable siblings in place and reports them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-unverifiable-'))
  try {
    const applications = join(root, 'Applications')
    const trash = join(root, 'Trash')
    const running = join(applications, 'Oh-DSH Desktop.app')
    const unknown = join(applications, 'Oh-DSH-Desktop.app')
    mkdirSync(join(unknown, 'Contents'), { recursive: true })
    writeFileSync(join(unknown, 'Contents', 'Info.plist'), '<plist/>')
    const probe = makeProbe({
      [unknown]: { identifier: 'ai.deepseek.oh-dsh-desktop', version: null },
    })

    const result = await retireStaleMacBundles({
      applicationsDir: applications,
      trashDirectory: trash,
      runningBundlePath: running,
      runningVersion: '0.1.5',
      probe,
    })

    assert.deepEqual(result.retired, [])
    assert.equal(result.failures.length, 1)
    assert.match(result.failures[0]!, /could not be verified; left in place/)
    assert.equal(existsSync(unknown), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('retireStaleMacBundles never retires the running bundle or newer siblings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-keep-'))
  try {
    const applications = join(root, 'Applications')
    const trash = join(root, 'Trash')
    const running = join(applications, 'Oh-DSH-Desktop.app')
    const newer = join(applications, 'Oh-DSH Desktop.app')
    mkdirSync(join(newer, 'Contents'), { recursive: true })
    writeFileSync(join(newer, 'Contents', 'Info.plist'), '<plist/>')
    const probe = makeProbe({
      [running]: { identifier: 'ai.deepseek.oh-dsh-desktop', version: '0.1.5' },
      [newer]: { identifier: 'ai.deepseek.oh-dsh-desktop', version: '0.1.6' },
    })

    const result = await retireStaleMacBundles({
      applicationsDir: applications,
      trashDirectory: trash,
      runningBundlePath: running,
      runningVersion: '0.1.5',
      probe,
    })

    assert.deepEqual(result.retired, [])
    assert.deepEqual(result.failures, [])
    assert.equal(existsSync(newer), true)
    assert.equal(existsSync(running), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
