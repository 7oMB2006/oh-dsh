import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { MockGitHub } from './helpers/mock-github.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const installPs1 = join(root, 'install.ps1')

const execFileAsync = promisify(execFile)

function powershellCommand(): string | undefined {
  for (const candidate of ['powershell', 'pwsh']) {
    const probe = spawnSync(candidate, ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' })
    if (probe.status === 0) return candidate
  }
  return undefined
}

const powershell = powershellCommand()

const skipReason = process.platform !== 'win32'
  ? 'install.ps1 targets Windows'
  : powershell === undefined
    ? 'no PowerShell available'
    : false

type InstallerResult = { status: number; stdout: string; stderr: string }

// Async on purpose: the mock GitHub server runs in this process, and a
// synchronous spawn would block the event loop that must answer install.ps1.
async function runInstaller(
  args: string[],
  env: Record<string, string>,
): Promise<InstallerResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      powershell!,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installPs1, ...args],
      { env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024 },
    )
    return { status: 0, stdout, stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return {
      status: failure.code ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function makeWindowsSurfaceArchive(
  surface: 'web' | 'tui',
  version: string,
  marker: string,
): Promise<{ name: string; bytes: Buffer }> {
  const staging = await mkdtemp(join(tmpdir(), `oh-dsh-${surface}-`))
  const base = `oh-dsh-${surface}-${version}-win-x64`
  const packageDir = join(staging, base)
  await mkdir(join(packageDir, 'bin'), { recursive: true })
  await mkdir(join(packageDir, 'lib', 'oh-dsh'), { recursive: true })
  await writeFile(join(packageDir, 'bin', 'ohdsh.cmd'), `@echo off\r\necho ${marker}\r\n`)
  await writeFile(join(packageDir, 'bin', 'ohdsh'), `#!/bin/sh\necho ${marker}\n`)
  await chmod(join(packageDir, 'bin', 'ohdsh'), 0o755)
  await writeFile(join(packageDir, 'lib', 'oh-dsh', 'cli.js'), `// ${marker}\n`)
  const tarball = join(staging, `${base}.tar.gz`)
  const tar = spawnSync('tar', ['-czf', tarball, '-C', staging, base], { encoding: 'utf8' })
  assert.equal(tar.status, 0, tar.stderr)
  return { name: `${base}.tar.gz`, bytes: await readFile(tarball) }
}

async function makeSandbox(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'oh-dsh-install-home-'))
}

test('tui install downloads, verifies, and lays out the payload with a launcher shim', { skip: skipReason }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeWindowsSurfaceArchive('tui', '0.1.8', 'stable'),
    ])
    const home = await makeSandbox()
const env = {}
    const payload = join(home, 'payload')
    const bin = join(home, 'bin')

    const result = await runInstaller(
      [
        '-Surface', 'tui',
        '-ApiBase', github.apiBase,
        '-DownloadBase', github.downloadBase,
        '-Dest', payload,
        '-BinDir', bin,
        '-DataHome', join(home, 'data'),
      ],
      env,
    )

    assert.equal(result.status, 0, result.stderr)
    assert.ok(github.sawRequest('/releases/latest'))
    assert.equal(github.downloadCount('v0.1.8', 'oh-dsh-tui-0.1.8-win-x64.tar.gz'), 1)
    assert.ok(await exists(join(payload, 'bin', 'ohdsh.cmd')))
    assert.ok(await exists(join(payload, 'lib', 'oh-dsh', 'cli.js')))
    const marker = await readFile(join(payload, '.oh-dsh-install.env'), 'utf8')
    assert.match(marker, /^OH_DSH_INSTALL_SURFACE=tui$/m)
    assert.match(marker, /^OH_DSH_INSTALL_VERSION=0\.1\.8$/m)
    const shim = await readFile(join(bin, 'ohdsh.cmd'), 'utf8')
    assert.ok(shim.includes('launcher.env'), `shim must dispatch via launcher.env: ${shim}`)
    assert.match(result.stdout, /Verified sha256:/)
  } finally {
    await github.stop()
  }
})

test('a checksum mismatch fails closed and keeps the previous tui install usable', { skip: skipReason }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    const good = await makeWindowsSurfaceArchive('tui', '0.1.8', 'good')
    github.publish('v0.1.8', [good])
    const home = await makeSandbox()
const env = {}
    const payload = join(home, 'payload')
    const bin = join(home, 'bin')
    const args = [
      '-Surface', 'tui',
      '-ApiBase', github.apiBase,
      '-DownloadBase', github.downloadBase,
      '-Dest', payload,
      '-BinDir', bin,
      '-DataHome', join(home, 'data'),
    ]
    assert.equal((await runInstaller(args, env)).status, 0)

    github.tamperAsset(
      'v0.1.8',
      good.name,
      (await makeWindowsSurfaceArchive('tui', '0.1.8', 'tampered')).bytes,
    )
    const failing = await runInstaller([...args, '-Force'], env)
    assert.notEqual(failing.status, 0)
    assert.match(failing.stdout + failing.stderr, /checksum mismatch/)
    const launcher = await readFile(join(payload, 'bin', 'ohdsh.cmd'), 'utf8')
    assert.match(launcher, /good/)
  } finally {
    await github.stop()
  }
})

test('same-version reruns are no-ops and upgrades clean staged leftovers', { skip: skipReason }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeWindowsSurfaceArchive('tui', '0.1.8', 'old'),
    ])
    const home = await makeSandbox()
const env = {}
    const payload = join(home, 'payload')
    const bin = join(home, 'bin')
    const args = [
      '-Surface', 'tui',
      '-ApiBase', github.apiBase,
      '-DownloadBase', github.downloadBase,
      '-Dest', payload,
      '-BinDir', bin,
      '-DataHome', join(home, 'data'),
    ]
    const asset = 'oh-dsh-tui-0.1.8-win-x64.tar.gz'
    assert.equal((await runInstaller(args, env)).status, 0)
    const rerun = await runInstaller(args, env)
    assert.equal(rerun.status, 0)
    assert.match(rerun.stdout, /already installed/)
    assert.equal(github.downloadCount('v0.1.8', asset), 1)

    await mkdir(join(home, 'payload.previous'), { recursive: true })
    await mkdir(join(home, 'payload.install-pending'), { recursive: true })
    github.publish('v0.1.9', [
      await makeWindowsSurfaceArchive('tui', '0.1.9', 'new'),
    ])
    github.setLatest('v0.1.9')
    const upgrade = await runInstaller(args, env)
    assert.equal(upgrade.status, 0, upgrade.stderr)
    assert.match(await readFile(join(payload, 'bin', 'ohdsh.cmd'), 'utf8'), /new/)
    const entries = await readdir(home)
    assert.ok(!entries.some(entry => entry.includes('previous') || entry.includes('install-pending')))
  } finally {
    await github.stop()
  }
})

test('uninstall removes the payload and the installer-owned shim', { skip: skipReason }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeWindowsSurfaceArchive('web', '0.1.8', 'bye'),
    ])
    const home = await makeSandbox()
const env = {}
    const payload = join(home, 'payload')
    const bin = join(home, 'bin')
    const args = [
      '-Surface', 'web',
      '-ApiBase', github.apiBase,
      '-DownloadBase', github.downloadBase,
      '-Dest', payload,
      '-BinDir', bin,
      '-DataHome', join(home, 'data'),
    ]
    assert.equal((await runInstaller(args, env)).status, 0)
    const uninstall = await runInstaller([...args, '-Uninstall'], env)
    assert.equal(uninstall.status, 0, uninstall.stderr)
    assert.ok(!(await exists(payload)))
    assert.ok(!(await exists(join(bin, 'ohdsh.cmd'))))
  } finally {
    await rm(join(tmpdir(), 'oh-dsh-tui-'), { force: true, recursive: true }).catch(() => {})
    await rm(join(tmpdir(), 'oh-dsh-web-'), { force: true, recursive: true }).catch(() => {})
    await github.stop()
  }
})
