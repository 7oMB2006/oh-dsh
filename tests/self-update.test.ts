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
  latestReleaseApiUrl,
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

  const unixPlan = selfUpdatePlan('web', 'linux')
  assert.equal(unixPlan.command, 'sh')
  assert.deepEqual(unixPlan.args, ['<script>', '--surface', 'web'])

  const windowsPlan = selfUpdatePlan('tui', 'win32')
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
