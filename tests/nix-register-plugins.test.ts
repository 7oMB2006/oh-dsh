import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function writeRegistryFixture(surface: string) {
  const fixture = mkdtempSync(join(tmpdir(), `oh-dsh-nix-registry-${surface}-`))
  const bundleRoot = join(fixture, 'bundle')
  const manifests = join(bundleRoot, 'manifests')
  const distRoot = join(fixture, 'dist')
  const preset = join(bundleRoot, 'tui-renderer', 'presets', 'liangshen')
  const runtime = join(fixture, 'runtime')

  mkdirSync(join(manifests), { recursive: true })
  mkdirSync(join(distRoot, 'plugins', 'liangshen'), { recursive: true })
  mkdirSync(join(distRoot, 'web'), { recursive: true })
  mkdirSync(preset, { recursive: true })
  mkdirSync(runtime, { recursive: true })

  writeFileSync(
    join(manifests, 'liangshen.json'),
    JSON.stringify({ name: '@oh-dsh/liangshen', version: '0.1.0', dependencies: {} }),
  )
  writeFileSync(
    join(manifests, 'web.json'),
    JSON.stringify({ name: '@oh-dsh/web', version: '0.1.8', dependencies: {} }),
  )
  writeFileSync(join(distRoot, 'plugins', 'liangshen', 'index.js'), 'export {}\n')
  writeFileSync(join(distRoot, 'web', 'index.js'), 'export {}\n')
  writeFileSync(join(preset, 'preset.yml'), 'id: liangshen\n')
  writeFileSync(
    join(runtime, 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh', dependencies: {} }),
  )
  return { bundleRoot, distRoot, runtime, fixture }
}

function runRegistry(fixture: { bundleRoot: string, distRoot: string, runtime: string }, surface: string) {
  const result = spawnSync(
    'python3',
    [join(root, 'nix', 'register-plugins.py'), fixture.bundleRoot, fixture.distRoot, fixture.runtime, surface],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
}

test('Nix registry carries the Liangshen preset into web and full closures', () => {
  for (const surface of ['web', 'full']) {
    const fixture = writeRegistryFixture(surface)
    try {
      runRegistry(fixture, surface)
      const liangshen = join(fixture.runtime, 'node_modules', '@oh-dsh', 'liangshen')
      assert.equal(existsSync(join(liangshen, 'dist', 'index.js')), true, `${surface}: compiled plugin`)
      assert.equal(
        existsSync(join(liangshen, 'presets', 'liangshen', 'preset.yml')),
        true,
        `${surface}: packaged preset`,
      )
      const runtime = JSON.parse(readFileSync(join(fixture.runtime, 'package.json'), 'utf8'))
      assert.equal(runtime.dependencies['@oh-dsh/liangshen'], '0.1.0', `${surface}: profile dependency`)
    } finally {
      rmSync(fixture.fixture, { recursive: true, force: true })
    }
  }
})

test('Nix registry leaves the TUI closure on its upstream Liangshen preset', () => {
  const fixture = writeRegistryFixture('tui')
  try {
    runRegistry(fixture, 'tui')
    assert.equal(existsSync(join(fixture.runtime, 'node_modules', '@oh-dsh', 'liangshen')), false)
    const runtime = JSON.parse(readFileSync(join(fixture.runtime, 'package.json'), 'utf8'))
    assert.equal('@oh-dsh/liangshen' in runtime.dependencies, false)
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true })
  }
})
