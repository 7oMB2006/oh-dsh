import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { resolveDshSource, resolvePinnedPnpm } from './dsh-source.mjs'

const dshSource = resolveDshSource()
const pnpm = resolvePinnedPnpm(dshSource)

/**
 * npm runs scripts with the project's node_modules/.bin ahead of PATH, and
 * the DSH build scripts call `pnpm` for nested workspace commands. Pin that
 * bin to the declared CLI so the inner calls never reach a host pnpm whose
 * version-switch verification rejects the pinned lockfile.
 */
function pinInnerPnpm() {
  const binDir = join(dshSource, 'node_modules', '.bin')
  mkdirSync(binDir, { recursive: true })
  if (process.platform === 'win32') {
    writeFileSync(join(binDir, 'pnpm.cmd'),
      `@"${process.execPath}" "${pnpm.cliEntry}" %*\r\n`)
  } else {
    const launcher = join(binDir, 'pnpm')
    writeFileSync(launcher,
      `#!/bin/sh\nexec "${process.execPath}" "${pnpm.cliEntry}" "$@"\n`)
    chmodSync(launcher, 0o755)
  }
}

function run(args) {
  const result = spawnSync(process.execPath, [
    pnpm.cliEntry,
    ...args,
  ], {
    cwd: dshSource,
    env: {
      ...process.env,
      PATH: `${pnpm.binDir}${delimiter}${process.env.PATH ?? ''}`,
    },
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${pnpm.cliEntry} ${args.join(' ')} failed with status ${String(result.status)}`)
  }
}

/**
 * Expose the built-in Vision settings section through DSH's existing
 * configuration-client boundary. The pinned release keeps a fixed allowlist;
 * patch only the checkout used for this build and restore the tracked source
 * immediately afterwards so the upstream checkout remains pristine.
 */
function withVisionSettingsNamespace(build) {
  const path = join(
    dshSource,
    'packages', 'host', 'apiproxy', 'src', 'api-proxy.ts',
  )
  const source = readFileSync(path, 'utf8')
  const original = "  'agent-loop', 'shell', 'locale', 'permission', 'ui-conversation', 'ui-theme', 'web-search-deepseek',\n"
  const replacement = `${original}  'oh-dsh-vision',\n`
  if (!source.includes(original)) {
    throw new Error('pinned DSH API proxy settings allowlist changed; Vision patch needs review')
  }
  let restored = false
  const restore = () => {
    if (restored) return
    restored = true
    writeFileSync(path, source)
  }
  const signals = process.platform === 'win32'
    ? ['SIGINT', 'SIGTERM']
    : ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']
  const handlers = new Map()
  const handleSignal = (signal) => {
    try {
      restore()
    } finally {
      // A signal listener suppresses Node's default termination. Restore the
      // checkout first, then re-raise the same signal so the build still
      // exits with the expected status.
      process.removeListener('exit', restore)
      process.kill(process.pid, signal)
    }
  }
  process.once('exit', restore)
  for (const signal of signals) {
    const handler = () => { handleSignal(signal) }
    handlers.set(signal, handler)
    process.once(signal, handler)
  }
  try {
    writeFileSync(path, source.replace(original, replacement))
    return build()
  } finally {
    restore()
    process.removeListener('exit', restore)
    for (const [signal, handler] of handlers) process.removeListener(signal, handler)
  }
}

run(['install', '--frozen-lockfile'])
pinInnerPnpm()
withVisionSettingsNamespace(() => run(['run', 'build']))
