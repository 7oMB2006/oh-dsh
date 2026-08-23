import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { installLiangshenPreset } from '../plugins/liangshen/src/index.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'upstream', 'dsh-TUI', 'presets', 'liangshen')

test('Liangshen plugin installs and reconciles its managed preset', () => {
  const temp = mkdtempSync(join(tmpdir(), 'oh-dsh-liangshen-'))
  const sourceCopy = join(temp, 'source')
  const dataRoot = join(temp, 'data')
  try {
    cpSync(source, sourceCopy, { recursive: true })
    assert.equal(installLiangshenPreset({ dataRoot, sourceRoot: sourceCopy }), 'installed')
    const target = join(dataRoot, '.agent-presets', 'liangshen')
    assert.match(requireFile(join(target, 'agent.cordis.yml')), /tool-bootstrap/)
    assert.equal(installLiangshenPreset({ dataRoot, sourceRoot: sourceCopy }), 'current')

    writeFileSync(join(sourceCopy, '.dsh-tui-managed.json'), JSON.stringify({
      owner: '@deepseek-harness-tui/dsh-tui',
      preset: 'liangshen',
      revision: 'next',
    }) + '\n')
    assert.equal(installLiangshenPreset({ dataRoot, sourceRoot: sourceCopy }), 'installed')
    assert.match(requireFile(join(target, '.dsh-tui-managed.json')), /"revision":"next"/)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('Liangshen plugin preserves an unmanaged user preset', () => {
  const temp = mkdtempSync(join(tmpdir(), 'oh-dsh-liangshen-conflict-'))
  const sourceCopy = join(temp, 'source')
  const dataRoot = join(temp, 'data')
  const target = join(dataRoot, '.agent-presets', 'liangshen')
  try {
    cpSync(source, sourceCopy, { recursive: true })
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'agent.cordis.yml'), 'user-owned\n')
    assert.equal(installLiangshenPreset({ dataRoot, sourceRoot: sourceCopy }), 'conflict')
    assert.equal(requireFile(join(target, 'agent.cordis.yml')), 'user-owned\n')
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

function requireFile(path: string): string {
  return readFileSync(path, 'utf8')
}
