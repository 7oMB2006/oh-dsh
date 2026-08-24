/** Unified launcher for the Oh-DSH interaction surfaces. */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { OH_DSH_HOME_ENV } from './data-root.ts'
import { UsageError } from './errors.ts'
import {
  detectDistributionSurface,
  installerOwnsRoot,
  runSelfUpdate,
} from './self-update.ts'
import { main as runTui, resolveTuiRoot } from './tui.ts'
import { main as runWeb } from './web.ts'

const SURFACE_NAMES = ['desktop', 'web', 'tui'] as const
type SurfaceName = typeof SURFACE_NAMES[number]
const SURFACE_ALIASES: Readonly<Record<string, SurfaceName>> = Object.freeze({
  gui: 'desktop',
})

export function availableSurfaces(env: NodeJS.ProcessEnv = process.env): readonly SurfaceName[] {
  const configured = env.OH_DSH_SURFACES
  if (configured === undefined || configured === '') return SURFACE_NAMES
  const requested = new Set(configured.split(',').map(value => value.trim()))
  return SURFACE_NAMES.filter(surface => requested.has(surface))
}

export function cliHelp(env: NodeJS.ProcessEnv = process.env): string {
  const surfaces = availableSurfaces(env)
  const aliases = Object.entries(SURFACE_ALIASES)
    .filter(([, surface]) => surfaces.includes(surface))
  const descriptions: Record<SurfaceName, string> = {
    desktop: 'Start Oh-DSH Desktop',
    web: 'Start Oh-DSH Web',
    tui: 'Start Oh-DSH TUI',
  }
  return `Oh-DSH launcher

Usage:
  ohdsh <surface> [options]
  ohdsh update [surface]

Surfaces:
${surfaces.map(surface => `  ${surface.padEnd(9)} ${descriptions[surface]}`).join('\n')}
${aliases.length === 0 ? '' : `\nAliases:\n${aliases.map(([alias, surface]) => `  ${alias.padEnd(9)} ${descriptions[surface]}`).join('\n')}`}

Commands:
  update    Upgrade this installation with the latest stable release
            installer (web/tui on every platform; the desktop application
            updates itself through its update window)

Run "ohdsh <surface> --help" for surface options.
`
}

export const CLI_HELP = cliHelp()

export interface DesktopLaunchSpec {
  args: string[]
  command: string
  cwd?: string
}

type WebRunner = typeof runWeb
type TuiRunner = typeof runTui
type DesktopRunner = (
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Promise<number>

function sourceElectron(
  root: string,
  platform: NodeJS.Platform,
): string {
  const paths = platform === 'win32' ? win32 : posix
  if (platform === 'darwin') {
    return paths.join(
      root,
      'node_modules',
      'electron',
      'dist',
      'Electron.app',
      'Contents',
      'MacOS',
      'Electron',
    )
  }
  return paths.join(
    root,
    'node_modules',
    'electron',
    'dist',
    platform === 'win32' ? 'electron.exe' : 'electron',
  )
}

function macOpenEnvironment(env: NodeJS.ProcessEnv): string[] {
  const ohDshHome = env[OH_DSH_HOME_ENV]
  return ohDshHome === undefined || ohDshHome === ''
    ? []
    : ['--env', `${OH_DSH_HOME_ENV}=${posix.resolve(ohDshHome)}`]
}

/** Resolve one desktop launch without starting a process. */
export function desktopLaunchSpec(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  pathExists: (path: string) => boolean = existsSync,
): DesktopLaunchSpec {
  const paths = platform === 'win32' ? win32 : posix
  const explicitApp = env.OH_DSH_DESKTOP_APP
  if (explicitApp !== undefined && explicitApp !== '') {
    if (platform === 'darwin') {
      return {
        args: [
          ...macOpenEnvironment(env),
          paths.resolve(explicitApp),
          ...(args.length === 0 ? [] : ['--args', ...args]),
        ],
        command: '/usr/bin/open',
      }
    }
    return { args: [...args], command: paths.resolve(explicitApp) }
  }

  const sourceRoot = env.OH_DSH_SOURCE_ROOT
  if (sourceRoot !== undefined && sourceRoot !== '') {
    const root = paths.resolve(sourceRoot)
    const electron = sourceElectron(root, platform)
    if (pathExists(electron)) {
      return {
        args: [root, ...args],
        command: electron,
        cwd: root,
      }
    }
  }

  if (platform === 'darwin') {
    return {
      args: [
        ...macOpenEnvironment(env),
        '-a',
        'Oh-DSH Desktop',
        ...(args.length === 0 ? [] : ['--args', ...args]),
      ],
      command: '/usr/bin/open',
    }
  }
  if (platform === 'win32') {
    return {
      args: ['/d', '/s', '/c', 'start', '""', 'Oh-DSH Desktop.exe', ...args],
      command: env.ComSpec ?? 'cmd.exe',
    }
  }
  return { args: [...args], command: 'oh-dsh-desktop' }
}

/** Start the desktop surface and detach the launcher. */
export async function launchDesktop(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const spec = desktopLaunchSpec(args, env)
  return await new Promise<number>((resolveLaunch, rejectLaunch) => {
    const child = spawn(spec.command, spec.args, {
      ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
      detached: true,
      env,
      stdio: 'ignore',
    })
    child.once('error', rejectLaunch)
    child.once('spawn', () => {
      child.unref()
      resolveLaunch(0)
    })
  })
}

/** Run "ohdsh update": upgrade the running distribution via the installer. */
export async function runUpdateCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  stdout: NodeJS.WriteStream,
  stderr: NodeJS.WriteStream,
): Promise<number> {
  const [requested] = args
  if (requested !== undefined && !SURFACE_NAMES.includes(requested as SurfaceName)) {
    stderr.write(`Unknown surface: ${requested}\n\n${cliHelp(env)}`)
    return 2
  }
  const root = resolveTuiRoot(env)
  const distribution = detectDistributionSurface(root, env)
  if (distribution === 'source') {
    stderr.write('ohdsh update needs a packaged installation; update a source checkout with git instead.\n')
    return 2
  }
  if (distribution === 'desktop') {
    stdout.write('The desktop application updates itself: open Oh-DSH Desktop -> Check for Updates...\n')
    return 0
  }
  const surface = requested === 'web' || requested === 'tui' ? requested : distribution
  // The running root must be a location the installer owns (its recorded or
  // default destination), inferred from path and install records, so an
  // update never silently installs somewhere else.
  if (!installerOwnsRoot(root, surface, env)) {
    stderr.write(
      `ohdsh update: this installation at ${root} has no installer record for surface '${surface}'. ` +
      'Re-run install.sh (or install.ps1) with --dest matching this location, or reinstall to the default location.\n',
    )
    return 2
  }
  stdout.write(`Upgrading Oh-DSH ${surface} with the latest stable release installer...\n`)
  return await runSelfUpdate(surface, env)
}

/** Dispatch one surface command. */
export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  stdout: NodeJS.WriteStream = process.stdout,
  stderr: NodeJS.WriteStream = process.stderr,
  desktopRunner: DesktopRunner = launchDesktop,
  webRunner: WebRunner = runWeb,
  tuiRunner: TuiRunner = runTui,
): Promise<number> {
  const [surface, ...args] = argv
  const selectedSurface = surface === undefined
    ? undefined
    : SURFACE_ALIASES[surface] ?? surface
  const help = cliHelp(env)
  if (surface === undefined || surface === '--help' || surface === '-h') {
    stdout.write(help)
    return 0
  }
  if (selectedSurface === 'update') {
    return await runUpdateCommand(args, env, stdout, stderr)
  }
  if (SURFACE_NAMES.includes(selectedSurface as SurfaceName)
    && !availableSurfaces(env).includes(selectedSurface as SurfaceName)) {
    stderr.write(`Surface '${surface}' is not included in this Oh-DSH distribution.\n\n${help}`)
    return 2
  }
  if (selectedSurface === 'desktop') return await desktopRunner(args, env)
  if (selectedSurface === 'web') return await webRunner(args, env, stdout)
  if (selectedSurface === 'tui') return await tuiRunner(args, env, stdout, stderr)
  stderr.write(`Unknown surface: ${surface}\n\n${help}`)
  return 2
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main(process.argv.slice(2)).then(code => {
    process.exit(code)
  }, error => {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`)
      process.exit(2)
    }
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    )
    process.exit(1)
  })
}
