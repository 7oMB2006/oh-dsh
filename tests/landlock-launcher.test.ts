import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import {
  landlockLauncherPackageName,
  restoreLandlockLauncher,
} from '../scripts/landlock-launcher.mjs'

const packageVersion = '0.1.1'

function writePackageManifest(packageRoot: string, version = packageVersion) {
  mkdirSync(packageRoot, { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name: landlockLauncherPackageName,
    version,
  }))
}

function writePrebuildManifest(packageRoot: string) {
  writeFileSync(join(packageRoot, 'prebuilds.json'), JSON.stringify({
    platform: 'linux-x64',
    binaries: [{
      tool: 'landlock-run',
      kind: 'static-musl',
      path: 'bin/landlock-run',
    }],
  }))
}

function packageRoot(runtimeRoot: string) {
  return join(runtimeRoot, 'node_modules', ...landlockLauncherPackageName.split('/'))
}

test('Linux staging restores the published Landlock launcher into the runtime package', () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-landlock-'))
  const runtimeRoot = join(root, 'runtime')
  const sourcePackageRoot = join(root, 'published')
  const targetPackageRoot = packageRoot(runtimeRoot)
  const sourceLauncher = join(sourcePackageRoot, 'bin', 'landlock-run')
  try {
    writePackageManifest(sourcePackageRoot)
    writePackageManifest(targetPackageRoot)
    writePrebuildManifest(targetPackageRoot)
    mkdirSync(dirname(sourceLauncher), { recursive: true })
    writeFileSync(sourceLauncher, 'published launcher')

    const targetLauncher = restoreLandlockLauncher({ runtimeRoot, sourcePackageRoot })

    assert.equal(targetLauncher, join(targetPackageRoot, 'bin', 'landlock-run'))
    assert.equal(readFileSync(targetLauncher, 'utf8'), 'published launcher')
    if (process.platform !== 'win32') {
      assert.equal(statSync(targetLauncher).mode & 0o777, 0o755)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Linux staging fails when the published Landlock launcher is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-landlock-'))
  const runtimeRoot = join(root, 'runtime')
  const sourcePackageRoot = join(root, 'published')
  const targetPackageRoot = packageRoot(runtimeRoot)
  try {
    writePackageManifest(sourcePackageRoot)
    writePackageManifest(targetPackageRoot)
    writePrebuildManifest(targetPackageRoot)

    assert.throws(
      () => restoreLandlockLauncher({ runtimeRoot, sourcePackageRoot }),
      /published Landlock launcher is missing/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('desktop pins the published Linux x64 Landlock launcher package', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.optionalDependencies?.[landlockLauncherPackageName], packageVersion)
})
