import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureDesktopProfile } from '../src/profile.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const resources = resolve(process.argv[2] ?? join(root, '.stage'))
const nodeBinary = join(resources, 'node-runtime', 'bin', 'node')
const cliEntry = join(resources, 'dsh-runtime', 'lib', 'bin.js')
const smokeRoot = mkdtempSync(join(tmpdir(), 'oh-dsh-desktop-smoke-'))
const dshHome = join(smokeRoot, 'dsh-home')
const lines = []

ensureDesktopProfile(dshHome)

const runtimeEnvironment = {
  ...process.env,
  DSH_DESKTOP: '1',
  DSH_DESKTOP_APP_DATA: smokeRoot,
  DSH_DESKTOP_PROFILE: 'desktop',
  DSH_DESKTOP_VERSION: 'smoke',
  DSH_HOME: dshHome,
  PATH: `${dirname(nodeBinary)}:${process.env.PATH ?? '/usr/bin:/bin'}`,
}

const pluginRoot = join(smokeRoot, 'smoke-plugin')
mkdirSync(pluginRoot)
writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({
  name: 'dsh-desktop-smoke-plugin',
  version: '1.0.0',
  type: 'module',
  exports: { '.': './index.js' },
  dsh: { bundle: { patch: './cordis.patch.yml' } },
}, undefined, 2))
writeFileSync(join(pluginRoot, 'index.js'), 'export function apply() {}\n')
writeFileSync(join(pluginRoot, 'cordis.patch.yml'), '[]\n')
const install = spawnSync(nodeBinary, [
  cliEntry, 'plugin', '--profile', 'desktop', 'add', pluginRoot,
], {
  cwd: smokeRoot,
  encoding: 'utf8',
  env: runtimeEnvironment,
})
assert.equal(install.status, 0, install.stderr || install.stdout)
const profileManifest = JSON.parse(readFileSync(join(dshHome, 'profiles', 'desktop', 'package.json'), 'utf8'))
assert.ok(profileManifest.dsh.profile.bundles.includes('dsh-desktop-smoke-plugin'))

const child = spawn(nodeBinary, [cliEntry, '--profile', 'desktop'], {
  cwd: smokeRoot,
  env: runtimeEnvironment,
  stdio: ['ignore', 'pipe', 'pipe'],
})

function lineReader(stream, resolveReady) {
  let pending = ''
  return chunk => {
    pending += chunk.toString('utf8')
    for (let newline = pending.indexOf('\n'); newline >= 0; newline = pending.indexOf('\n')) {
      const line = pending.slice(0, newline).replace(/\r$/, '')
      pending = pending.slice(newline + 1)
      lines.push(`[${stream}] ${line}`)
      const match = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/.exec(line)
      if (match?.[1] !== undefined) resolveReady(new URL(match[1]))
    }
  }
}

let readySettled = false
const ready = new Promise((resolve, reject) => {
  const resolveOnce = value => {
    if (readySettled) return
    readySettled = true
    resolve(value)
  }
  child.stdout.on('data', lineReader('stdout', resolveOnce))
  child.stderr.on('data', lineReader('stderr', resolveOnce))
  child.once('error', reject)
  child.once('exit', (code, signal) => {
    if (readySettled) return
    reject(new Error(`runtime exited before readiness (code=${String(code)}, signal=${String(signal)})\n${lines.join('\n')}`))
  })
})

const timeout = new Promise((_, reject) => {
  setTimeout(() => reject(new Error(`runtime readiness timed out\n${lines.join('\n')}`)), 60_000).unref()
})

try {
  const base = await Promise.race([ready, timeout])
  const indexResponse = await fetch(base)
  const index = await indexResponse.text()
  assert.equal(indexResponse.status, 200)
  assert.match(index, /<div id="root"><\/div>/)

  const pluginIds = [
    '@oh-dsh/panel-controls',
    '@oh-dsh/pinned-summary',
    '@oh-dsh/workspace-tools',
    '@oh-dsh/desktop-shell',
  ]
  const loaded = []
  for (const pluginId of pluginIds) {
    const bundleUrl = new URL(`/plugins/${pluginId}/client.js`, base)
    const bundleResponse = await fetch(bundleUrl)
    const bundle = await bundleResponse.text()
    assert.equal(bundleResponse.status, 200)
    assert.ok(bundle.includes(pluginId), `${pluginId} client bundle did not enroll its module id`)
    loaded.push(`${bundleUrl.href} (${String(bundle.length)} bytes)`)
  }

  for (const legacyPackage of ['dsh-web-terminal', '@dsh-external/dsh-web-panel']) {
    assert.equal(
      existsSync(join(resources, 'dsh-runtime', 'node_modules', ...legacyPackage.split('/'))),
      false,
      `${legacyPackage} must not be installed in the desktop runtime`,
    )
  }

  const workspaceResponse = await fetch(new URL(
    `/oh-dsh-desktop/workspace?cwd=${encodeURIComponent(smokeRoot)}`,
    base,
  ))
  const workspaceSnapshot = await workspaceResponse.json()
  assert.equal(workspaceResponse.status, 200)
  assert.equal(workspaceSnapshot.kind, 'directory')
  assert.equal(workspaceSnapshot.cwd, smokeRoot)

  const terminalUrl = new URL('/oh-dsh-desktop/terminal/ws', base)
  terminalUrl.protocol = 'ws:'
  await new Promise((resolveTerminal, rejectTerminal) => {
    const socket = new WebSocket(terminalUrl)
    let output = ''
    let settled = false
    const terminalTimeout = setTimeout(() => {
      finish(new Error(`terminal smoke timed out; output=${JSON.stringify(output)}`))
    }, 10_000)
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(terminalTimeout)
      socket.close()
      if (error === undefined) resolveTerminal()
      else rejectTerminal(error)
    }
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'start', cols: 80, rows: 24, cwd: smokeRoot }))
    })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.type === 'ready') {
        assert.equal(message.cwd, smokeRoot)
        socket.send(JSON.stringify({ type: 'input', data: "printf 'OH_DSH_TERMINAL_SMOKE\\n'; exit\r" }))
      } else if (message.type === 'output') {
        output += message.data
      } else if (message.type === 'error') {
        finish(new Error(`terminal host error: ${message.message}`))
      } else if (message.type === 'exit') {
        try {
          assert.match(output, /OH_DSH_TERMINAL_SMOKE/)
          finish()
        } catch (error) {
          finish(error)
        }
      }
    })
    socket.addEventListener('error', () => { finish(new Error('terminal websocket connection failed')) })
    socket.addEventListener('close', () => {
      if (!settled) finish(new Error(`terminal websocket closed early; output=${JSON.stringify(output)}`))
    })
  })

  console.log(`Oh-DSH-Desktop profile ready: ${base.href}`)
  for (const bundle of loaded) console.log(`Bundled client plugin: ${bundle}`)
  console.log('Desktop terminal PTY: ready, command execution verified')
} finally {
  if (child.exitCode === null) child.kill('SIGTERM')
  await new Promise(resolve => {
    if (child.exitCode !== null) resolve()
    else child.once('exit', resolve)
  })
  rmSync(smokeRoot, { recursive: true, force: true })
}
