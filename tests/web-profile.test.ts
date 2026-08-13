import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  DESKTOP_PROFILE,
  ensureWebProfile,
  WEB_BUNDLES,
  WEB_PROFILE,
} from '../src/profile.ts'
import {
  DEFAULT_DATA_DIR_NAME,
  DEFAULT_WEB_HOST,
  DEFAULT_WEB_PORT,
  parseLaunchArgs,
  UsageError,
} from '../src/web.ts'

test('web profile initializes required bundles and preserves user plugins', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-web-profile-'))
  try {
    const first = ensureWebProfile(join(root, 'home'))
    const manifestPath = join(first.profileDir, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    assert.equal(manifest.name, 'dsh-profile-web')
    assert.deepEqual(manifest.dsh.profile.bundles, WEB_BUNDLES)
    assert.equal(manifest.dsh.profile.bundles.includes('@oh-dsh/desktop'), false)

    manifest.dependencies['example-plugin'] = '1.0.0'
    manifest.dsh.profile.bundles = ['example-plugin', '@oh-dsh/web']
    writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
    writeFileSync(join(first.profileDir, 'cordis.patch.yml'), '- id: custom\n  disabled: true\n')

    const second = ensureWebProfile(join(root, 'home'))
    const upgraded = JSON.parse(readFileSync(join(second.profileDir, 'package.json'), 'utf8'))
    assert.deepEqual(upgraded.dsh.profile.bundles, [...WEB_BUNDLES, 'example-plugin'])
    assert.equal(upgraded.dependencies['example-plugin'], '1.0.0')
    assert.match(readFileSync(join(second.profileDir, 'cordis.patch.yml'), 'utf8'), /custom/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('web profile is a separate surface from the desktop profile', () => {
  assert.notEqual(WEB_PROFILE, DESKTOP_PROFILE)
  assert.deepEqual(WEB_BUNDLES, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@oh-dsh/web'])
  assert.equal(WEB_BUNDLES.includes('@oh-dsh/desktop'), false)
})

test('web bundle patch mounts the web-capable Oh-DSH plugins', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const patch = readFileSync(join(root, 'web', 'cordis.patch.yml'), 'utf8')
  for (const row of [
    'oh-web',
    'oh-better-sidebar-runtime',
    'oh-skins',
    'oh-pinned-summary',
    'oh-sidebar',
    'oh-panel-controls',
  ]) {
    assert.match(patch, new RegExp(`- id: ${row}`))
  }
  // Electron-bound surfaces stay out of the web composition.
  for (const desktopRow of ['oh-desktop', 'oh-plugin-marketplace']) {
    assert.doesNotMatch(patch, new RegExp(`- id: ${desktopRow}\\b`))
  }
})

test('web launcher defaults match the dsh-web-app bundle surface', () => {
  const options = parseLaunchArgs([], {}, false, `/home/user/${DEFAULT_DATA_DIR_NAME}`)
  assert.equal(options.host, DEFAULT_WEB_HOST)
  assert.equal(options.port, DEFAULT_WEB_PORT)
  assert.equal(options.open, false)
  assert.equal(options.dataRoot, `/home/user/${DEFAULT_DATA_DIR_NAME}`)
  assert.deepEqual(options.trustedHosts, [])
  assert.equal(options.help, false)
})

test('web launcher honors environment and flag precedence', () => {
  const base = parseLaunchArgs([], {
    DSH_OH_WEB_HOST: '0.0.0.0',
    DSH_OH_WEB_PORT: '9090',
    DSH_OH_WEB_HOME: '/data/web',
    DSH_OH_WEB_OPEN: '0',
  }, true, '/default')
  assert.equal(base.host, '0.0.0.0')
  assert.equal(base.port, 9090)
  assert.equal(base.dataRoot, '/data/web')
  assert.equal(base.open, false)

  const flags = parseLaunchArgs([
    '--host', '127.0.0.1',
    '--port=8080',
    '--data', '/flags',
    '--open',
    '--trusted-host', 'lab.internal:3080',
    '--trusted-host=10.0.0.9',
  ], {
    DSH_OH_WEB_HOST: '0.0.0.0',
    DSH_OH_WEB_PORT: '9090',
  }, false, '/default')
  assert.equal(flags.host, '127.0.0.1')
  assert.equal(flags.port, 8080)
  assert.equal(flags.dataRoot, '/flags')
  assert.equal(flags.open, true)
  assert.deepEqual(flags.trustedHosts, ['lab.internal:3080', '10.0.0.9'])

  const noOpen = parseLaunchArgs(['--no-open'], { DSH_OH_WEB_OPEN: '1' }, true, '/default')
  assert.equal(noOpen.open, false)
})

test('web launcher rejects invalid arguments', () => {
  assert.throws(() => parseLaunchArgs(['--port', 'not-a-port'], {}, false, '/d'), UsageError)
  assert.throws(() => parseLaunchArgs(['--port', '70000'], {}, false, '/d'), UsageError)
  assert.throws(() => parseLaunchArgs(['--host'], {}, false, '/d'), UsageError)
  assert.throws(() => parseLaunchArgs(['--unknown'], {}, false, '/d'), UsageError)
  assert.throws(() => parseLaunchArgs([], { DSH_OH_WEB_PORT: 'abc' }, false, '/d'), UsageError)
})

test('web launcher --help short-circuits', () => {
  const options = parseLaunchArgs(['--help'], {}, false, '/d')
  assert.equal(options.help, true)
})
