import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { restoreSettingsBoundary } from '../scripts/settings-boundary.mjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-settings-boundary-'))
  const index = join(
    root,
    'node_modules',
    '.pnpm',
    '@deepseek-ai+dsh-host-apiproxy@0.1.0-rc.7',
    'node_modules',
    '@deepseek-ai',
    'dsh-host-apiproxy',
    'lib',
    'index.js',
  )
  mkdirSync(dirname(index), { recursive: true })
  writeFileSync(index, [
    'const DEFAULT_MAX_MESSAGES = 50;',
    'const snapshot = {',
    '  namespaces: settings.describe({ redactSecrets: true }).map(namespaceView)',
    '};',
    'let branded = settingsNamespace(ns);',
  ].join('\n'))
  return { root, index }
}

test('settings boundary patches every assembled runtime idempotently', () => {
  const { root, index } = fixture()
  try {
    restoreSettingsBoundary(root)
    const once = readFileSync(index, 'utf8')
    restoreSettingsBoundary(root)
    assert.equal(readFileSync(index, 'utf8'), once)
    assert.match(once, /WEB_SETTINGS_NAMESPACES/)
    assert.match(once, /ctx\.llm\.listConfigurableProviders\(\)/)
    assert.match(once, /settings-not-exposed/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Nix assembly applies the shared settings boundary', () => {
  const nix = readFileSync(
    new URL('../nix/oh-dsh.nix', import.meta.url),
    'utf8',
  )
  const boundary = nix.indexOf('${../scripts/settings-boundary.mjs}')
  const registration = nix.indexOf('${./register-plugins.py}')
  assert.ok(boundary >= 0)
  assert.ok(registration >= 0)
  assert.ok(boundary < registration)
})
