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
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { MockGitHub } from './helpers/mock-github.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const installSh = join(root, 'install.sh')

const execFileAsync = promisify(execFile)

type InstallerResult = { status: number; stdout: string; stderr: string }

// Async on purpose: the mock GitHub server runs in this process, and a
// synchronous spawn would block the event loop that must answer install.sh.
async function runInstaller(
  args: string[],
  env: Record<string, string>,
): Promise<InstallerResult> {
  try {
    const { stdout, stderr } = await execFileAsync('sh', [installSh, ...args], {
      env: { ...process.env, ...env },
      maxBuffer: 16 * 1024 * 1024,
    })
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

function run(command: string, args: string[], options: { cwd?: string } = {}):
ReturnType<typeof spawnSync> {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed: ${result.stderr}`,
  )
  return result
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function makeSurfaceArchive(
  surface: 'web' | 'tui',
  version: string,
  os: 'darwin' | 'linux',
  arch: 'arm64' | 'x64',
  marker: string,
): Promise<{ name: string; bytes: Buffer }> {
  const staging = await mkdtemp(join(tmpdir(), `oh-dsh-${surface}-`))
  const base = `oh-dsh-${surface}-${version}-${os}-${arch}`
  const packageDir = join(staging, base)
  await mkdir(join(packageDir, 'bin'), { recursive: true })
  await mkdir(join(packageDir, 'lib', 'oh-dsh'), { recursive: true })
  await writeFile(join(packageDir, 'bin', 'ohdsh'), `#!/bin/sh\necho ${marker}\n`)
  await chmod(join(packageDir, 'bin', 'ohdsh'), 0o755)
  await writeFile(join(packageDir, 'lib', 'oh-dsh', 'cli.js'), `// ${marker}\n`)
  const tarball = join(staging, `${base}.tar.gz`)
  run('tar', ['-czf', tarball, '-C', staging, base])
  return { name: `${base}.tar.gz`, bytes: await readFile(tarball) }
}

async function makeMacDesktopZip(
  version: string,
  arch: 'arm64' | 'x64',
): Promise<{ name: string; bytes: Buffer }> {
  const staging = await mkdtemp(join(tmpdir(), 'oh-dsh-desktop-'))
  const appDir = join(staging, 'Oh-DSH Desktop.app')
  await mkdir(join(appDir, 'Contents', 'MacOS'), { recursive: true })
  await mkdir(join(appDir, 'Contents', 'Resources'), { recursive: true })
  const executable = join(appDir, 'Contents', 'MacOS', 'Oh-DSH Desktop')
  await writeFile(executable, `#!/bin/sh\necho desktop-${version}\n`)
  await chmod(executable, 0o755)
  await writeFile(join(appDir, 'Contents', 'Resources', 'app.asar'), 'asar')
  const zipPath = join(staging, `Oh-DSH-Desktop-${version}-${arch}.zip`)
  if (process.platform === 'darwin') {
    run('ditto', ['-c', '-k', '--keepParent', appDir, zipPath])
  } else {
    run('zip', ['-rq', zipPath, 'Oh-DSH Desktop.app'], { cwd: staging })
  }
  return { name: `Oh-DSH-Desktop-${version}-${arch}.zip`, bytes: await readFile(zipPath) }
}

async function makeLsregisterSpy(
  directory: string,
): Promise<{ bin: string; logPath: string }> {
  const logPath = join(directory, 'lsregister.log')
  const bin = join(directory, 'lsregister')
  await writeFile(bin, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(logPath)}\n`)
  await chmod(bin, 0o755)
  return { bin, logPath }
}

async function makeSandbox(
  github: MockGitHub,
  extra: Record<string, string> = {},
): Promise<{ home: string; env: Record<string, string> }> {
  const home = await mkdtemp(join(tmpdir(), 'oh-dsh-install-home-'))
  return {
    home,
    env: {
      HOME: home,
      OH_DSH_API_BASE: github.apiBase,
      OH_DSH_DOWNLOAD_BASE: github.downloadBase,
      ...extra,
    },
  }
}

const skipOnWindows = process.platform === 'win32'
  ? 'install.sh targets macOS and Linux'
  : false

test('web install resolves the latest stable release and installs only the web surface', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.2.0-rc.1', [
      await makeSurfaceArchive('web', '0.2.0-rc.1', 'linux', 'x64', 'rc'),
    ])
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'stable'),
      await makeSurfaceArchive('tui', '0.1.8', 'linux', 'x64', 'stable'),
    ])
    github.setLatest('v0.1.8')
    const { home, env } = await makeSandbox(github)
    const payload = join(home, 'payload')
    const bin = join(home, 'bin')

    const result = await runInstaller(
      ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', bin],
      env,
    )

    assert.equal(result.status, 0, result.stderr)
    assert.ok(github.sawRequest('/releases/latest'))
    assert.ok(!github.sawRequest('/releases/tags/'))
    assert.equal(github.downloadCount('v0.1.8', 'oh-dsh-web-0.1.8-linux-x64.tar.gz'), 1)
    assert.equal(github.downloadCount('v0.1.8', 'oh-dsh-tui-0.1.8-linux-x64.tar.gz'), 0)
    assert.ok(await exists(join(payload, 'bin', 'ohdsh')))
    assert.ok(await exists(join(payload, 'lib', 'oh-dsh', 'cli.js')))
    assert.equal(await readlink(join(bin, 'ohdsh')), join(payload, 'bin', 'ohdsh'))
    const marker = await readFile(join(payload, '.oh-dsh-install.env'), 'utf8')
    assert.match(marker, /^OH_DSH_INSTALL_SURFACE=web$/m)
    assert.match(marker, /^OH_DSH_INSTALL_VERSION=0\.1\.8$/m)
    assert.match(marker, /^OH_DSH_INSTALL_ASSET=oh-dsh-web-0\.1\.8-linux-x64\.tar\.gz$/m)
    assert.match(result.stdout, /Installed Oh-DSH web 0\.1\.8/)
  } finally {
    await github.stop()
  }
})

test('a checksum mismatch fails closed and leaves the previous web install usable', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    const good = await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'good')
    github.publish('v0.1.8', [good])
    const { home, env } = await makeSandbox(github)
    const payload = join(home, 'payload')
    const bin = join(home, 'bin')
    const args = ['--surface', 'web', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', bin]
    assert.equal((await runInstaller(args, env)).status, 0)

    // Republish the same asset with tampered bytes: the served download no
    // longer matches the published digest.
    github.tamperAsset(
      'v0.1.8',
      good.name,
      (await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'tampered')).bytes,
    )

    const failing = await runInstaller([...args, '--force'], env)
    assert.notEqual(failing.status, 0)
    assert.match(failing.stderr, /checksum mismatch/)
    const binohdsh = await readFile(join(payload, 'bin', 'ohdsh'), 'utf8')
    assert.match(binohdsh, /good/)
    const marker = await readFile(join(payload, '.oh-dsh-install.env'), 'utf8')
    assert.match(marker, /OH_DSH_INSTALL_VERSION=0\.1\.8/)
    const parentEntries = await readdir(home)
    assert.ok(!parentEntries.some(entry => entry.includes('install-pending')))
  } finally {
    await github.stop()
  }
})

test('tui installs are idempotent, --force reinstalls, and upgrades replace the payload', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('tui', '0.1.8', 'linux', 'x64', 'old'),
    ])
    const { home, env } = await makeSandbox(github)
    const payload = join(home, 'payload')
    const bin = join(home, 'bin')
    const args = ['--surface', 'tui', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', bin]
    const asset = 'oh-dsh-tui-0.1.8-linux-x64.tar.gz'

    assert.equal((await runInstaller(args, env)).status, 0)
    const rerun = await runInstaller(args, env)
    assert.equal(rerun.status, 0)
    assert.match(rerun.stdout, /already installed/)
    assert.equal(github.downloadCount('v0.1.8', asset), 1)

    // Staged leftovers from an interrupted upgrade must not survive a retry.
    await mkdir(join(home, 'payload.previous-stale'), { recursive: true })
    await mkdir(join(home, 'payload.install-pending.stale'), { recursive: true })

    const forced = await runInstaller([...args, '--force'], env)
    assert.equal(forced.status, 0)
    assert.equal(github.downloadCount('v0.1.8', asset), 2)

    github.publish('v0.1.9', [
      await makeSurfaceArchive('tui', '0.1.9', 'linux', 'x64', 'new'),
    ])
    github.setLatest('v0.1.9')
    const upgrade = await runInstaller(args, env)
    assert.equal(upgrade.status, 0, upgrade.stderr)
    assert.match(await readFile(join(payload, 'bin', 'ohdsh'), 'utf8'), /new/)
    const marker = await readFile(join(payload, '.oh-dsh-install.env'), 'utf8')
    assert.match(marker, /OH_DSH_INSTALL_VERSION=0\.1\.9/)
    assert.equal(await readlink(join(bin, 'ohdsh')), join(payload, 'bin', 'ohdsh'))
    const parentEntries = await readdir(home)
    assert.ok(!parentEntries.some(entry => entry.includes('previous')))
    assert.ok(!parentEntries.some(entry => entry.includes('install-pending')))
  } finally {
    await github.stop()
  }
})

test('macOS desktop installs register the app bundle and retire stale bundles; other surfaces never do', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeMacDesktopZip('0.1.8', 'arm64'),
      await makeSurfaceArchive('tui', '0.1.8', 'linux', 'x64', 'tui'),
    ])
    const { home, env } = await makeSandbox(github)
    const spy = await makeLsregisterSpy(home)
    env.OH_DSH_LSREGISTER = spy.bin
    const apps = join(home, 'Applications')
    await mkdir(join(apps, 'Oh-DSH-Desktop.app'), { recursive: true })
    const staleBackup = join(apps, 'Oh-DSH Desktop-before-20200101-000000.app')
    await mkdir(join(staleBackup, 'Contents'), { recursive: true })

    const result = await runInstaller(
      ['--surface', 'desktop', '--os', 'darwin', '--arch', 'arm64', '--dest', apps],
      env,
    )
    assert.equal(result.status, 0, result.stderr)

    const installedApp = join(apps, 'Oh-DSH Desktop.app')
    assert.ok(await exists(join(installedApp, 'Contents', 'MacOS', 'Oh-DSH Desktop')))
    assert.ok(!(await exists(join(apps, 'Oh-DSH-Desktop.app'))))
    assert.ok(!(await exists(staleBackup)), 'stale pre-upgrade backups must be removed')
    assert.ok(!(await exists(join(apps, '.Oh-DSH Desktop.app.install.9999'))))
    assert.match(result.stdout, /Removed the previous app bundle|Installed/)
    const lsregisterLog = await readFile(spy.logPath, 'utf8')
    assert.match(lsregisterLog, new RegExp(`-f .*${'Oh-DSH Desktop.app'}`))
    const markerPath = join(home, '.local', 'share', 'oh-dsh', 'desktop', 'install.env')
    const marker = await readFile(markerPath, 'utf8')
    assert.match(marker, /^OH_DSH_INSTALL_SURFACE=desktop$/m)
    assert.match(marker, /^OH_DSH_INSTALL_ASSET=Oh-DSH-Desktop-0\.1\.8-arm64\.zip$/m)

    // Web and TUI installs must not touch application registration.
    await rm(spy.logPath, { force: true })
    const payload = join(home, 'tui-payload')
    const bin = join(home, 'tui-bin')
    const tui = await runInstaller(
      ['--surface', 'tui', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', bin],
      env,
    )
    assert.equal(tui.status, 0, tui.stderr)
    assert.ok(!(await exists(spy.logPath)))
    assert.ok(await exists(join(payload, 'bin', 'ohdsh')))
  } finally {
    await github.stop()
  }
})

test('pinned --version selects that release tag instead of latest', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('web', '0.1.8', 'linux', 'x64', 'newest'),
    ])
    github.publish('v0.1.7', [
      await makeSurfaceArchive('web', '0.1.7', 'linux', 'x64', 'pinned'),
    ])
    const { home, env } = await makeSandbox(github)
    const result = await runInstaller(
      [
        '--surface', 'web', '--version', 'v0.1.7',
        '--os', 'linux', '--arch', 'x64',
        '--dest', join(home, 'payload'), '--bin-dir', join(home, 'bin'),
      ],
      env,
    )
    assert.equal(result.status, 0, result.stderr)
    assert.ok(github.sawRequest('/releases/tags/v0.1.7'))
    assert.equal(github.downloadCount('v0.1.7', 'oh-dsh-web-0.1.7-linux-x64.tar.gz'), 1)
    assert.equal(github.downloadCount('v0.1.8', 'oh-dsh-web-0.1.8-linux-x64.tar.gz'), 0)
    assert.match(await readFile(join(home, 'payload', 'bin', 'ohdsh'), 'utf8'), /pinned/)
  } finally {
    await github.stop()
  }
})

test('unsupported targets fail with actionable messages', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [])
    const { env } = await makeSandbox(github)

    const arm = await runInstaller(['--surface', 'tui', '--os', 'linux', '--arch', 'arm64'], env)
    assert.notEqual(arm.status, 0)
    assert.match(arm.stderr, /linux-arm64/)

    const windows = await runInstaller(['--surface', 'desktop', '--os', 'win'], env)
    assert.notEqual(windows.status, 0)
    assert.match(windows.stderr, /install\.ps1/)

    const surface = await runInstaller(['--surface', 'editor'], env)
    assert.notEqual(surface.status, 0)
    assert.match(surface.stderr, /unsupported surface/)

    const missing = await runInstaller(['--surface', 'tui', '--os', 'linux', '--arch', 'x64'], env)
    assert.notEqual(missing.status, 0)
    assert.match(missing.stderr, /oh-dsh-tui-0\.1\.8-linux-x64\.tar\.gz/)
  } finally {
    await github.stop()
  }
})

test('uninstall removes the surface payload, launcher, and desktop app', { skip: skipOnWindows }, async () => {
  const github = new MockGitHub()
  await github.start()
  try {
    github.publish('v0.1.8', [
      await makeSurfaceArchive('tui', '0.1.8', 'linux', 'x64', 'bye'),
      await makeMacDesktopZip('0.1.8', 'arm64'),
    ])
    const { home, env } = await makeSandbox(github)
    const spy = await makeLsregisterSpy(home)
    env.OH_DSH_LSREGISTER = spy.bin

    const payload = join(home, 'payload')
    const bin = join(home, 'bin')
    const tuiArgs = ['--surface', 'tui', '--os', 'linux', '--arch', 'x64', '--dest', payload, '--bin-dir', bin]
    assert.equal((await runInstaller(tuiArgs, env)).status, 0)
    const tuiUninstall = await runInstaller(['--uninstall', ...tuiArgs], env)
    assert.equal(tuiUninstall.status, 0, tuiUninstall.stderr)
    assert.ok(!(await exists(payload)))
    assert.ok(!(await exists(join(bin, 'ohdsh'))))

    const apps = join(home, 'Applications')
    const desktopArgs = ['--surface', 'desktop', '--os', 'darwin', '--arch', 'arm64', '--dest', apps]
    assert.equal((await runInstaller(desktopArgs, env)).status, 0)
    const desktopUninstall = await runInstaller(['--uninstall', ...desktopArgs], env)
    assert.equal(desktopUninstall.status, 0, desktopUninstall.stderr)
    assert.ok(!(await exists(join(apps, 'Oh-DSH Desktop.app'))))
    const unregisterLog = await readFile(spy.logPath, 'utf8')
    assert.match(unregisterLog, /-u /)
  } finally {
    await github.stop()
  }
})
