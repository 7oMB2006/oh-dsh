import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import {
  compareDshVersions,
  RUNTIME_BUNDLE_MANIFEST,
  parseRuntimeBundleAsset,
  readRuntimePointer,
  resolveStagedRuntimeRoot,
  RuntimeUpdateManager,
  writePointer,
} from '../src/runtime-update.ts'

test('DSH version ordering follows release lines and prerelease ranks', () => {
  assert.equal(compareDshVersions('0.1.0-rc.7', '0.1.0-rc.8'), -1)
  assert.equal(compareDshVersions('0.1.0-rc.8', '0.1.1-rc.1'), -1)
  assert.equal(compareDshVersions('0.1.1-rc.1', '0.1.1-rc.2'), -1)
  assert.equal(compareDshVersions('0.1.1-rc.2', '0.1.1'), -1)
  assert.equal(compareDshVersions('0.1.1', '0.1.1-rc.2'), 1)
  assert.equal(compareDshVersions('0.1.1-rc.2', '0.1.1-rc.2'), 0)
  assert.equal(compareDshVersions('0.2.0-rc.1', '0.1.9'), 1)
})

test('runtime bundle asset names parse per platform and arch', () => {
  assert.equal(parseRuntimeBundleAsset('oh-dsh-runtime-0.1.1-rc.2-darwin-arm64.tar.gz', 'darwin', 'arm64'), '0.1.1-rc.2')
  assert.equal(parseRuntimeBundleAsset('oh-dsh-runtime-0.1.1-rc.2-win32-x64.tar.gz', 'win32', 'x64'), '0.1.1-rc.2')
  assert.equal(parseRuntimeBundleAsset('oh-dsh-runtime-0.1.1-rc.2-linux-x64.tar.gz', 'darwin', 'arm64'), null)
  assert.equal(parseRuntimeBundleAsset('oh-dsh-tui-0.1.7-darwin-arm64.tar.gz', 'darwin', 'arm64'), null)
})

function stagedLayout(root: string, version: string, appVersion = '0.1.7'): string {
  writeFileSync(join(root, RUNTIME_BUNDLE_MANIFEST), JSON.stringify({
    bundledByAppVersion: appVersion,
    dshVersion: version,
  }))
  const runtimeRoot = join(root, 'runtimes', version, 'dsh-runtime')
  mkdirSync(join(runtimeRoot, 'lib'), { recursive: true })
  writeFileSync(join(runtimeRoot, 'lib', 'bin.js'), '')
  writeFileSync(join(runtimeRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version }))
  return runtimeRoot
}

test('staged runtime pointer resolves only valid deployments', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'oh-dsh-runtime-pointer-'))
  try {
    assert.equal(resolveStagedRuntimeRoot(dataRoot), null)
    const runtimeRoot = stagedLayout(dataRoot, '0.1.1-rc.2')
    writePointer(join(dataRoot, 'runtimes'), { dshRuntimeRoot: runtimeRoot, version: '0.1.1-rc.2' })
    assert.deepEqual(readRuntimePointer(dataRoot), {
      dshRuntimeRoot: runtimeRoot,
      version: '0.1.1-rc.2',
    })
    assert.equal(resolveStagedRuntimeRoot(dataRoot), runtimeRoot)

    // A pointer naming a different version than the deployment is ignored.
    writePointer(join(dataRoot, 'runtimes'), { dshRuntimeRoot: runtimeRoot, version: '9.9.9' })
    assert.equal(resolveStagedRuntimeRoot(dataRoot), null)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
})

function fakeReleasesResponse(assets: Array<{ name: string }>): Response {
  return new Response(JSON.stringify([
    {
      tag_name: 'v0.1.8',
      name: 'Oh-DSH 0.1.8',
      body: 'Runtime refresh',
      html_url: 'https://github.com/hust-open-atom-club/oh-dsh/releases/tag/v0.1.8',
      prerelease: false,
      assets: assets.map(asset => ({
        browser_download_url: `https://example.test/${asset.name}`,
        name: asset.name,
        size: 1024,
      })),
    },
  ]), { status: 200 })
}

test('runtime update manager selects the newest matching bundle', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'oh-dsh-runtime-update-'))
  const states: string[] = []
  try {
    const manager = new RuntimeUpdateManager({
      appVersion: '0.1.7',
      arch: 'arm64',
      bundledVersion: '0.1.0-rc.7',
      currentVersion: '0.1.0-rc.7',
      dataRoot,
      fetchImpl: (async () => fakeReleasesResponse([
        { name: 'oh-dsh-runtime-0.1.1-rc.1-darwin-arm64.tar.gz' },
        { name: 'oh-dsh-runtime-0.1.1-rc.2-darwin-arm64.tar.gz' },
        { name: 'oh-dsh-runtime-0.1.0-rc.7-darwin-arm64.tar.gz' },
        { name: 'oh-dsh-runtime-0.1.1-rc.2-linux-x64.tar.gz' },
        { name: 'oh-dsh-tui-0.1.7-darwin-arm64.tar.gz' },
      ])) as typeof fetch,
      nodeBinary: process.execPath,
      onState: state => { states.push(state.status) },
      platform: 'darwin',
    })
    const available = await manager.command({ type: 'check' })
    assert.equal(available.status, 'available')
    if (available.status !== 'available') return
    assert.equal(available.candidate.dshVersion, '0.1.1-rc.2')
    assert.equal(available.candidate.releaseName, 'Oh-DSH 0.1.8')
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
})

test('runtime update manager stages, verifies, and activates a bundle', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'oh-dsh-runtime-install-'))
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'oh-dsh-runtime-fixture-'))
  try {
    const fixtureRuntime = stagedLayout(fixtureRoot, '0.1.1-rc.2')
    let applied = false
    const manager = new RuntimeUpdateManager({
      appVersion: '0.1.7',
      arch: 'arm64',
      bundledVersion: '0.1.0-rc.7',
      currentVersion: '0.1.0-rc.7',
      dataRoot,
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/releases')) {
          return fakeReleasesResponse([{ name: 'oh-dsh-runtime-0.1.1-rc.2-darwin-arm64.tar.gz' }])
        }
        if (url.endsWith('.sha256')) return new Response('eb333942340dfa7da54597d78b894f35310289e75ec3a84137a197a37ab1d164  bundle\n', { status: 200 })
        return new Response(Readable.toWeb(Readable.from([Buffer.from('bundle-bytes')] as Buffer[])) as unknown as ReadableStream, { status: 200 })
      }) as typeof fetch,
      nodeBinary: process.execPath,
      onRuntimeChanged: () => { applied = true },
      onLog: () => {},
      platform: 'darwin',
      // Stand in for tar (copy the fixture layout) and the node smoke probe.
      runCommand: async (file, args) => {
        if (file === 'tar') {
          const target = args.at(-1)!
          cpSync(fixtureRuntime, join(target, 'dsh-runtime'), { recursive: true })
          cpSync(join(fixtureRoot, RUNTIME_BUNDLE_MANIFEST), join(target, RUNTIME_BUNDLE_MANIFEST))
          return { stderr: '', stdout: '' }
        }
        const runtimeRoot = join(dirname(args[0]!), '..')
        const manifest = JSON.parse(readFileSync(join(runtimeRoot, 'package.json'), 'utf8')) as { version: string }
        return { stderr: '', stdout: `${manifest.version}\n` }
      },
    })
    await manager.command({ type: 'check' })
    const installed = await manager.command({ type: 'install' })
    if (installed.status === 'error') throw new Error(`install failed: ${installed.stage}: ${installed.message}`)
    assert.equal(installed.status, 'installed')
    assert.equal(applied, true)
    assert.equal(
      resolveStagedRuntimeRoot(dataRoot),
      join(dataRoot, 'runtimes', '0.1.1-rc.2', 'dsh-runtime'),
    )

    const rolledBack = await manager.command({ type: 'rollback' })
    assert.equal(rolledBack.status, 'rolled-back')
    assert.equal(resolveStagedRuntimeRoot(dataRoot), null)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test('runtime update manager reports up to date without a newer bundle', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'oh-dsh-runtime-uptodate-'))
  try {
    const manager = new RuntimeUpdateManager({
      appVersion: '0.1.7',
      arch: 'arm64',
      bundledVersion: '0.1.1-rc.2',
      currentVersion: '0.1.1-rc.2',
      dataRoot,
      fetchImpl: (async () => fakeReleasesResponse([
        { name: 'oh-dsh-runtime-0.1.1-rc.2-darwin-arm64.tar.gz' },
        { name: 'oh-dsh-runtime-0.1.0-rc.8-darwin-arm64.tar.gz' },
      ])) as typeof fetch,
      nodeBinary: process.execPath,
      platform: 'darwin',
    })
    const state = await manager.command({ type: 'check' })
    assert.equal(state.status, 'not-available')
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
})

test('runtime update manager refuses to activate a failed smoke check', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'oh-dsh-runtime-badsmoke-'))
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'oh-dsh-runtime-fixture2-'))
  try {
    stagedLayout(fixtureRoot, '0.1.1-rc.2')
    const manager = new RuntimeUpdateManager({
      appVersion: '0.1.7',
      arch: 'arm64',
      bundledVersion: '0.1.0-rc.7',
      currentVersion: '0.1.0-rc.7',
      dataRoot,
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/releases')) {
          return fakeReleasesResponse([{ name: 'oh-dsh-runtime-0.1.1-rc.2-darwin-arm64.tar.gz' }])
        }
        if (url.endsWith('.sha256')) return new Response(null, { status: 404 })
        return new Response('x', { status: 200 })
      }) as typeof fetch,
      nodeBinary: process.execPath,
      platform: 'darwin',
      runCommand: async (file, args) => {
        if (file === 'tar') {
          const target = args.at(-1)!
          cpSync(join(fixtureRoot, 'runtimes', '0.1.1-rc.2', 'dsh-runtime'), join(target, 'dsh-runtime'), { recursive: true })
          cpSync(join(fixtureRoot, RUNTIME_BUNDLE_MANIFEST), join(target, RUNTIME_BUNDLE_MANIFEST))
          return { stderr: '', stdout: '' }
        }
        // A lying runtime that reports a different version than the bundle.
        return { stderr: '', stdout: '0.0.0\n' }
      },
    })
    await manager.command({ type: 'check' })
    const failed = await manager.command({ type: 'install' })
    assert.equal(failed.status, 'error')
    if (failed.status === 'error') assert.match(failed.message, /smoke check/)
    assert.equal(readRuntimePointer(dataRoot), null)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

test('runtime update manager surfaces check failures without changing state', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'oh-dsh-runtime-checkfail-'))
  try {
    const manager = new RuntimeUpdateManager({
      appVersion: '0.1.7',
      arch: 'arm64',
      bundledVersion: '0.1.0-rc.7',
      currentVersion: '0.1.0-rc.7',
      dataRoot,
      fetchImpl: (async () => new Response('nope', { status: 503 })) as typeof fetch,
      nodeBinary: process.execPath,
      platform: 'darwin',
    })
    const state = await manager.command({ type: 'check' })
    assert.equal(state.status, 'error')
    if (state.status === 'error') assert.equal(state.stage, 'check')
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
})

test('runtime update manager refuses bundles from a newer application', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'oh-dsh-runtime-newerapp-'))
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'oh-dsh-runtime-fixture3-'))
  try {
    // Bundle produced by a newer Oh-DSH Desktop than the running one.
    stagedLayout(fixtureRoot, '0.1.1-rc.2', '0.2.0')
    const manager = new RuntimeUpdateManager({
      appVersion: '0.1.7',
      arch: 'arm64',
      bundledVersion: '0.1.0-rc.7',
      currentVersion: '0.1.0-rc.7',
      dataRoot,
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/releases')) {
          return fakeReleasesResponse([{ name: 'oh-dsh-runtime-0.1.1-rc.2-darwin-arm64.tar.gz' }])
        }
        if (url.endsWith('.sha256')) return new Response(null, { status: 404 })
        return new Response('x', { status: 200 })
      }) as typeof fetch,
      nodeBinary: process.execPath,
      platform: 'darwin',
      runCommand: async (file, args) => {
        if (file === 'tar') {
          const target = args.at(-1)!
          cpSync(join(fixtureRoot, 'runtimes', '0.1.1-rc.2', 'dsh-runtime'), join(target, 'dsh-runtime'), { recursive: true })
          cpSync(join(fixtureRoot, RUNTIME_BUNDLE_MANIFEST), join(target, RUNTIME_BUNDLE_MANIFEST))
          return { stderr: '', stdout: '' }
        }
        return { stderr: '', stdout: '0.1.1-rc.2\n' }
      },
    })
    await manager.command({ type: 'check' })
    const refused = await manager.command({ type: 'install' })
    assert.equal(refused.status, 'error')
    if (refused.status === 'error') assert.match(refused.message, /update Oh-DSH Desktop first/)
    assert.equal(readRuntimePointer(dataRoot), null)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})
