/** Oh-DSH-Web launcher: boot the packaged web profile and expose its URL. */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ensureWebProfile, WEB_PROFILE } from './profile.ts'
import { DshRuntimeSupervisor, type RuntimeExit } from './runtime.ts'
import { bundledRuntimePaths, runtimeSearchPath, type BundledRuntimePaths } from './runtime-paths.ts'

/** Default port matching the dsh-web-app bundle's own webserver default. */
export const DEFAULT_WEB_PORT = 3080
/** Default bind host: loopback only. Use 0.0.0.0 to expose the UI on the LAN. */
export const DEFAULT_WEB_HOST = '127.0.0.1'
/** Default writable data root. */
export const DEFAULT_DATA_DIR_NAME = '.oh-dsh-web'

/** Launch options resolved from argv and environment. */
export interface LaunchOptions {
  dataRoot: string
  help: boolean
  host: string
  open: boolean
  port: number
  trustedHosts: string[]
}

export class UsageError extends Error {}

const USAGE = `usage: oh-dsh-web [options]

Options:
  --host <host>           bind host (default ${DEFAULT_WEB_HOST}; use 0.0.0.0 to expose the UI on the LAN)
  --port <port>           listen port (default ${DEFAULT_WEB_PORT}; 0 picks a random port)
  --data <dir>            writable data root (default ~/${DEFAULT_DATA_DIR_NAME})
  --trusted-host <auth>   extra authority the browser-trust fence accepts (repeatable)
  --open, --no-open       open the browser when ready (default: open on an interactive terminal)
  --help                  show this help

Environment:
  DSH_OH_WEB_HOST, DSH_OH_WEB_PORT, DSH_OH_WEB_HOME, DSH_OH_WEB_OPEN
`

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) throw new UsageError(`invalid port: ${value}`)
  const port = Number(value)
  if (port > 65_535) throw new UsageError(`invalid port: ${value}`)
  return port
}

function parseOpen(value: string): boolean {
  if (value === '1' || value.toLowerCase() === 'true') return true
  if (value === '0' || value.toLowerCase() === 'false') return false
  throw new UsageError(`invalid DSH_OH_WEB_OPEN value: ${value}`)
}

function envBoolean(env: NodeJS.ProcessEnv, name: string): boolean | undefined {
  const value = env[name]
  if (value === undefined || value === '') return undefined
  return parseOpen(value)
}

/**
 * Resolve launch options from argv and environment, in that precedence
 * order. Pure so tests can exercise it without touching process state.
 */
export function parseLaunchArgs(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  interactive: boolean,
  defaultDataRoot: string,
): LaunchOptions {
  const options: LaunchOptions = {
    dataRoot: env.DSH_OH_WEB_HOME ?? defaultDataRoot,
    help: false,
    host: env.DSH_OH_WEB_HOST ?? DEFAULT_WEB_HOST,
    open: envBoolean(env, 'DSH_OH_WEB_OPEN') ?? interactive,
    port: env.DSH_OH_WEB_PORT === undefined ? DEFAULT_WEB_PORT : parsePort(env.DSH_OH_WEB_PORT),
    trustedHosts: [],
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? ''
    if (argument === '--help' || argument === '-h') {
      options.help = true
      continue
    }
    if (argument === '--open') {
      options.open = true
      continue
    }
    if (argument === '--no-open') {
      options.open = false
      continue
    }
    const flag = (name: string): string | undefined => {
      if (argument === name) {
        const value = args[index + 1]
        if (value === undefined) throw new UsageError(`${name} needs a value`)
        index += 1
        return value
      }
      if (argument.startsWith(`${name}=`)) return argument.slice(name.length + 1)
      return undefined
    }
    const host = flag('--host')
    if (host !== undefined) {
      options.host = host
      continue
    }
    const port = flag('--port')
    if (port !== undefined) {
      options.port = parsePort(port)
      continue
    }
    const data = flag('--data')
    if (data !== undefined) {
      options.dataRoot = data
      continue
    }
    const trustedHost = flag('--trusted-host')
    if (trustedHost !== undefined) {
      options.trustedHosts.push(trustedHost)
      continue
    }
    throw new UsageError(`unknown option: ${argument}`)
  }
  return options
}

/** Resolve the distribution root: the packaged install root or the repo stage. */
export function resolveWebRoot(env: NodeJS.ProcessEnv = process.env): string {
  const packaged = env.DSH_OH_WEB_ROOT
  if (packaged !== undefined && packaged !== '') return packaged
  // Development layout: dist/web.js lives directly under the repository root.
  return dirname(dirname(fileURLToPath(import.meta.url)))
}

function versionOf(root: string): string {
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown }
    if (typeof manifest.version === 'string') return manifest.version
  } catch {
    // A missing manifest is a development layout quirk; fall through.
  }
  return '0.0.0'
}

function openBrowser(url: string, platform: NodeJS.Platform): void {
  const command = platform === 'darwin' ? 'open' : platform === 'linux' ? 'xdg-open' : undefined
  if (command === undefined) return
  try {
    const child = spawn(command, [url], { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
  } catch {
    // Opening the browser is best-effort; the URL is always printed.
  }
}

function printLine(ring: string[], line: string): void {
  process.stdout.write(`${line}\n`)
  ring.push(line)
  if (ring.length > 80) ring.splice(0, ring.length - 80)
}

/**
 * Boot the Oh-DSH-Web distribution and keep it running until a signal
 * arrives. Exits 0 on a clean stop, 1 on runtime failure.
 */
export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  stdout: NodeJS.WriteStream = process.stdout,
): Promise<number> {
  const options = parseLaunchArgs(
    argv,
    env,
    stdout.isTTY === true,
    join(homedir(), DEFAULT_DATA_DIR_NAME),
  )
  if (options.help) {
    stdout.write(USAGE)
    return 0
  }

  const root = resolveWebRoot(env)
  const version = versionOf(root)
  // Packaged layout: <root>/node-runtime + <root>/dsh-runtime. Development
  // layout: the staged runtimes live under <root>/.stage/.
  const resourcesRoot = env.DSH_OH_WEB_ROOT !== undefined
    ? root
    : existsSync(join(root, '.stage', 'node-runtime', 'bin', 'node'))
      ? join(root, '.stage')
      : root
  const paths: BundledRuntimePaths = bundledRuntimePaths(resourcesRoot)
  if (!existsSync(paths.nodeBinary)) {
    throw new Error(`packaged Node runtime is missing: ${paths.nodeBinary}`)
  }
  if (!existsSync(paths.cliEntry)) {
    throw new Error(`packaged DSH CLI is missing: ${paths.cliEntry}`)
  }

  const dshHome = join(options.dataRoot, 'dsh')
  mkdirSync(options.dataRoot, { recursive: true, mode: 0o700 })
  ensureWebProfile(dshHome)

  const logTail: string[] = []
  const runtime = new DshRuntimeSupervisor({
    args: [
      '--profile', WEB_PROFILE,
      '--host', options.host,
      '--port', String(options.port),
      ...options.trustedHosts.flatMap(host => ['--trusted-host', host]),
    ],
    cliEntry: paths.cliEntry,
    cwd: options.dataRoot,
    env: {
      ...env,
      DSH_HOME: dshHome,
      DSH_OH_WEB: '1',
      DSH_OH_WEB_DATA: options.dataRoot,
      DSH_OH_WEB_PROFILE: WEB_PROFILE,
      DSH_OH_WEB_VERSION: version,
      NODE_USE_ENV_PROXY: '1',
      PATH: runtimeSearchPath(paths, env),
    },
    nodeBinary: paths.nodeBinary,
    onLog: (stream, line) => { printLine(logTail, `${stream === 'stderr' ? '[runtime]' : ''}${line}`) },
    readyTimeoutMs: 60_000,
  })

  let stopping = false
  const stop = async (): Promise<void> => {
    if (stopping) return
    stopping = true
    await runtime.stop()
  }
  const onSignal = (): void => {
    void stop().then(() => { process.exit(0) })
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  runtime.on('exit', (exit: RuntimeExit) => {
    if (stopping) return
    process.stderr.write(
      `Oh-DSH-Web stopped (code=${String(exit.code)}, signal=${String(exit.signal)})\n`
      + `${logTail.slice(-20).join('\n')}\n`,
    )
    process.exit(1)
  })

  try {
    const url = await runtime.start()
    stdout.write(`Oh-DSH-Web ${version} is running at ${url.href}\n`)
    if (options.open) openBrowser(url.href, process.platform)
    await new Promise<void>(() => {})
    return 0
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.stderr.write(`${logTail.slice(-20).join('\n')}\n`)
    await stop()
    return 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main(process.argv.slice(2)).then(code => { process.exit(code) }, error => {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${USAGE}`)
      process.exit(2)
    }
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exit(1)
  })
}
