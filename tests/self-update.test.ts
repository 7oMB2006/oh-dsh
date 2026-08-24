import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  checkForUpdate,
  detectDistributionSurface,
  fetchLatestVersion,
  formatUpdateNotice,
  installScriptUrl,
  installerOwnsRoot,
  latestReleaseApiUrl,
  readLauncherRecord,
  runSelfUpdate,
  selfUpdatePlan,
  startupUpdateNotice,
  updateCheckEnabled,
  type UpdateFetcher,
} from '../src/self-update.ts'

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 500,
    headers: { 'content-type': 'application/json' },
  })
}

function releaseFetcher(tag: string): UpdateFetcher {
  return async () => await Promise.resolve(jsonResponse({ tag_name: tag }))
}

const isUnix = process.platform !== 'win32'

test('update checks respect the opt-out and endpoint overrides', async () => {
  assert.equal(updateCheckEnabled({}), true)
  assert.equal(updateCheckEnabled({ OH_DSH_UPDATE_CHECK: '0' }), false)
  assert.equal(updateCheckEnabled({ OH_DSH_UPDATE_CHECK: 'false' }), false)
  assert.equal(updateCheckEnabled({ OH_DSH_UPDATE_CHECK: '1' }), true)

  assert.equal(
    latestReleaseApiUrl({}),
    'https://api.github.com/repos/hust-open-atom-club/oh-dsh/releases/latest',
  )
  assert.equal(
    latestReleaseApiUrl({ OH_DSH_UPDATE_API_BASE: 'http://127.0.0.1:9/' }),
    'http://127.0.0.1:9/repos/hust-open-atom-club/oh-dsh/releases/latest',
  )

  let called = false
  const counting: UpdateFetcher = async () => {
    called = true
    return jsonResponse({ tag_name: 'v9.0.0' })
  }
  assert.equal(await fetchLatestVersion({ OH_DSH_UPDATE_CHECK: '0' }, counting), undefined)
  assert.equal(called, false)
  assert.equal(await fetchLatestVersion({}, counting), '9.0.0')
})

test('checkForUpdate compares semver and fails closed on bad input', async () => {
  const older = await checkForUpdate('0.1.8', {}, releaseFetcher('v0.2.0'))
  assert.deepEqual(older, { current: '0.1.8', latest: '0.2.0', updateAvailable: true })

  const same = await checkForUpdate('0.2.0', {}, releaseFetcher('v0.2.0'))
  assert.equal(same?.updateAvailable, false)

  const newerLocal = await checkForUpdate('0.3.0', {}, releaseFetcher('v0.2.0'))
  assert.equal(newerLocal?.updateAvailable, false)

  assert.equal(await checkForUpdate('not-a-version', {}, releaseFetcher('v0.2.0')), undefined)
  assert.equal(await checkForUpdate('0.1.8', {}, releaseFetcher('not-a-tag')), undefined)

  const failing: UpdateFetcher = async () => {
    throw new Error('offline')
  }
  assert.equal(await checkForUpdate('0.1.8', {}, failing), undefined)

  const serverError: UpdateFetcher = async () => jsonResponse({ message: 'nope' }, false)
  assert.equal(await checkForUpdate('0.1.8', {}, serverError), undefined)
})

test('the startup notice names both versions and the update command', async () => {
  assert.equal(
    formatUpdateNotice({ current: '0.1.8', latest: '0.2.0', updateAvailable: true }),
    'Oh-DSH 0.1.8 -> 0.2.0 is available. Run "ohdsh update" to upgrade.\n',
  )
  const notice = await startupUpdateNotice('0.1.8', {}, releaseFetcher('v0.2.0'))
  assert.match(notice ?? '', /ohdsh update/)
  const quiet = await startupUpdateNotice('0.2.0', {}, releaseFetcher('v0.2.0'))
  assert.equal(quiet, undefined)
  const disabled = await startupUpdateNotice(
    '0.1.8',
    { OH_DSH_UPDATE_CHECK: '0' },
    releaseFetcher('v0.2.0'),
  )
  assert.equal(disabled, undefined)
})

test('a startup check slower than the notice budget is abandoned silently', async () => {
  const slow: UpdateFetcher = () => new Promise<Response>(() => {})
  const started = Date.now()
  const notice = await startupUpdateNotice('0.1.8', {}, slow)
  const elapsed = Date.now() - started
  assert.equal(notice, undefined)
  assert.ok(elapsed < 5_000, `budget must bound the wait, took ${String(elapsed)}ms`)
})

test('installer plans target the platform script and surface', () => {
  assert.match(installScriptUrl('darwin'), /\/install\.sh$/)
  assert.match(installScriptUrl('linux'), /\/install\.sh$/)
  assert.match(installScriptUrl('win32'), /\/install\.ps1$/)
  assert.equal(
    installScriptUrl('darwin', 'hust-open-atom-club/oh-dsh', {
      OH_DSH_INSTALL_SCRIPT_URL: 'http://127.0.0.1:9/install.sh',
    }),
    'http://127.0.0.1:9/install.sh',
  )

  const unixPlan = selfUpdatePlan('web', 'linux', 'hust-open-atom-club/oh-dsh', {
    HOME: '/nonexistent-clean-home',
  })
  assert.equal(unixPlan.command, 'sh')
  assert.deepEqual(unixPlan.args, ['<script>', '--surface', 'web'])

  const windowsPlan = selfUpdatePlan('tui', 'win32', 'hust-open-atom-club/oh-dsh', {
    LOCALAPPDATA: 'Z:\\no-such-place',
  })
  assert.equal(windowsPlan.command, 'powershell')
  assert.deepEqual(
    windowsPlan.args.slice(0, 4),
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'],
  )
  assert.deepEqual(windowsPlan.args.slice(-2), ['-Surface', 'tui'])
})

test('distribution detection separates desktop, web, tui, and source', async () => {
  const home = await mkdtemp(join(tmpdir(), 'oh-dsh-detect-'))

  const desktop = join(home, 'app-resources')
  await mkdir(join(desktop, 'lib'), { recursive: true })
  assert.equal(
    detectDistributionSurface(desktop, { OH_DSH_DESKTOP_APP: '/Applications/Oh-DSH Desktop.app' }),
    'desktop',
  )

  const web = join(home, 'web-pkg')
  await mkdir(join(web, 'lib', 'oh-dsh-web'), { recursive: true })
  await writeFile(join(web, 'lib', 'oh-dsh-web', 'main.js'), '')
  await mkdir(join(web, 'lib', 'oh-dsh'), { recursive: true })
  await writeFile(join(web, 'lib', 'oh-dsh', 'cli.js'), '')
  assert.equal(detectDistributionSurface(web, { DSH_OH_WEB_ROOT: web }), 'web')

  const tui = join(home, 'tui-pkg')
  await mkdir(join(tui, 'lib', 'oh-dsh'), { recursive: true })
  await writeFile(join(tui, 'lib', 'oh-dsh', 'cli.js'), '')
  assert.equal(detectDistributionSurface(tui, { DSH_OH_TUI_ROOT: tui }), 'tui')

  assert.equal(
    detectDistributionSurface(web, { OH_DSH_SOURCE_ROOT: home }),
    'source',
  )
})

test('runSelfUpdate downloads and executes the installer for the surface', { skip: !isUnix }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'oh-dsh-selfupdate-'))
  const ranPath = join(home, 'ran.txt')
  const script = `#!/bin/sh\nprintf '%s\\n' "$*" > ${JSON.stringify(ranPath)}\n`
  const body = Buffer.from(script, 'utf8')

  const fetchImpl: UpdateFetcher = async () => new Response(body, { status: 200 })
  const code = await runSelfUpdate('web', { ...process.env }, 'linux', fetchImpl)
  assert.equal(code, 0)
  assert.equal(await readFile(ranPath, 'utf8'), '--surface web\n')
})

test('runSelfUpdate reports a failed installer download', async () => {
  const failing: UpdateFetcher = async () => new Response('not found', { status: 404 })
  await assert.rejects(
    () => runSelfUpdate('tui', { ...process.env }, process.platform, failing),
    /failed to download the installer/,
  )
})

test('launcher records are parsed inertly and drive update destinations', () => {
  const env = { XDG_DATA_HOME: '/data', HOME: '/home' }
  const record = readLauncherRecord(env, 'linux', path =>
    path.replaceAll('\\', '/').endsWith('/data/oh-dsh/launcher.env')
      ? 'WEB_DEST=/opt/oh web\nTUI_DEST=/opt/oh tui\nBIN_DIR=/opt/bin\nOH_DSH_NOPE=ignored\n'
      : undefined,
  )
  assert.deepEqual(record, { webDest: '/opt/oh web', tuiDest: '/opt/oh tui', binDir: '/opt/bin' })

  const plan = selfUpdatePlan('web', 'linux', 'hust-open-atom-club/oh-dsh', {
    ...env,
    OH_DSH_UPDATE_API_BASE: undefined,
    XDG_DATA_HOME: env.XDG_DATA_HOME,
    HOME: env.HOME,
  })
  // No records on disk in this environment: plain default install flags.
  assert.deepEqual(plan.args, ['<script>', '--surface', 'web'])
})

test('selfUpdatePlan reconstructs recorded destinations per platform', async () => {
  const home = await mkdtemp(join(tmpdir(), 'oh-dsh-plan-'))
  const dataHome = join(home, '.local', 'share', 'oh-dsh')
  await mkdir(dataHome, { recursive: true })
  await writeFile(join(dataHome, 'launcher.env'), 'WEB_DEST=/custom/web\nBIN_DIR=/custom/bin\n')
  const unixPlan = selfUpdatePlan('web', 'linux', 'hust-open-atom-club/oh-dsh', { HOME: home })
  assert.deepEqual(unixPlan.args, [
    '<script>', '--surface', 'web', '--dest', '/custom/web', '--bin-dir', '/custom/bin',
  ])

  const winHome = await mkdtemp(join(tmpdir(), 'oh-dsh-plan-win-'))
  const winData = join(winHome, 'oh-dsh')
  await mkdir(winData, { recursive: true })
  await writeFile(join(winData, 'launcher.env'), 'WEB_DEST=C:\\custom web\nBIN_DIR=C:\\custom bin\n')
  const winPlan = selfUpdatePlan('web', 'win32', 'hust-open-atom-club/oh-dsh', { LOCALAPPDATA: winHome })
  assert.deepEqual(winPlan.args.slice(-4), ['-Dest', 'C:\\custom web', '-BinDir', 'C:\\custom bin'])
})

test('installer ownership follows markers, defaults, and records', async () => {
  const home = await mkdtemp(join(tmpdir(), 'oh-dsh-owns-'))
  const dataHome = join(home, '.local', 'share', 'oh-dsh')
  const env = { HOME: home }

  const defaultPayload = join(dataHome, 'web')
  await mkdir(defaultPayload, { recursive: true })
  await writeFile(join(defaultPayload, '.oh-dsh-install.env'), 'OH_DSH_INSTALL_SURFACE=web\n')
  assert.equal(installerOwnsRoot(defaultPayload, 'web', env), true)
  assert.equal(installerOwnsRoot(defaultPayload, 'tui', env), false)

  const foreign = join(home, 'elsewhere')
  await mkdir(join(foreign, 'lib'), { recursive: true })
  assert.equal(installerOwnsRoot(foreign, 'web', env), false)

  const custom = join(home, 'custom tui')
  await mkdir(join(dataHome), { recursive: true })
  await writeFile(join(dataHome, 'launcher.env'), `TUI_DEST=${custom}\nBIN_DIR=${join(home, 'bin')}\n`)
  assert.equal(installerOwnsRoot(custom, 'tui', env), true)
})

test('detection prefers the payload marker and app path over layout probes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'oh-dsh-detect2-'))
  const dataHome = join(home, '.local', 'share', 'oh-dsh')
  const env = { HOME: home }

  // A payload marker wins even inside a foreign directory.
  const marked = join(home, 'manual')
  await mkdir(marked, { recursive: true })
  await writeFile(join(marked, '.oh-dsh-install.env'), 'OH_DSH_INSTALL_SURFACE=tui\n')
  assert.equal(detectDistributionSurface(marked, env, () => true), 'tui')

  // macOS .app resource paths are desktop regardless of anything else.
  assert.equal(
    detectDistributionSurface(
      '/Applications/Oh-DSH Desktop.app/Contents/Resources',
      env,
      () => false,
      'darwin',
    ),
    'desktop',
  )

  // The installer's default payload path is recognized without a marker.
  const defaultWeb = join(dataHome, 'web')
  await mkdir(defaultWeb, { recursive: true })
  assert.equal(detectDistributionSurface(defaultWeb, env, () => false), 'web')

  // Recorded custom destinations are recognized via launcher.env.
  const customTui = join(home, 'custom tui')
  await mkdir(dataHome, { recursive: true })
  await writeFile(join(dataHome, 'launcher.env'), `TUI_DEST=${customTui}\n`)
  await mkdir(customTui, { recursive: true })
  assert.equal(detectDistributionSurface(customTui, env, () => false), 'tui')

  // Manual archives fall back to the payload layout.
  const manual = join(home, 'extracted')
  await mkdir(join(manual, 'lib', 'oh-dsh'), { recursive: true })
  await writeFile(join(manual, 'lib', 'oh-dsh', 'cli.js'), '')
  assert.equal(detectDistributionSurface(manual, env, undefined), 'tui')
  assert.equal(
    detectDistributionSurface(manual, { HOME: home, OH_DSH_SOURCE_ROOT: home }, undefined),
    'source',
  )
})
