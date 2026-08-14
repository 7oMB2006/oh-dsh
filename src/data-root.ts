import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Environment variable overriding the shared Oh-DSH state root. */
export const OH_DSH_HOME_ENV = 'OH_DSH_HOME'

/** Default directory shared by the Desktop, Web, and TUI surfaces. */
export const DEFAULT_OH_DSH_HOME_DIRECTORY = '.ohdsh'

/** Resolve the default Oh-DSH state root for one user account. */
export function defaultOhDshHome(userHome: string = homedir()): string {
  return join(userHome, DEFAULT_OH_DSH_HOME_DIRECTORY)
}

/** Resolve the shared state root, honoring the cross-surface override. */
export function resolveOhDshHome(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = homedir(),
): string {
  const configured = env[OH_DSH_HOME_ENV]
  return resolve(configured === undefined || configured === ''
    ? defaultOhDshHome(userHome)
    : configured)
}

/** Keep Electron's Chromium data contained below the shared state root. */
export function desktopElectronDataRoot(ohDshHome: string): string {
  return join(ohDshHome, 'desktop')
}
