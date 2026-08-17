/**
 * Retire stale macOS application bundles after an in-place upgrade.
 *
 * The packaged .app bundle changed its file name during the 0.1.x series
 * (Oh-DSH-Desktop.app → Oh-DSH Desktop.app) while keeping the same bundle
 * identifier. Users who install from the release DMG by dragging the app into
 * /Applications never run scripts/install-mac.mjs, so Finder keeps both
 * bundles side by side instead of replacing the old one. The result is two
 * apps with the same bundle identifier, and Dock, Spotlight, and auto-update
 * can keep resolving the old location.
 *
 * This module implements the same cleanup the local installer performs, for
 * DMG installs: when the packaged app launches from /Applications it looks
 * for sibling bundles with the same bundle identifier, moves any that are
 * strictly older into the Trash, and re-registers the running bundle with
 * LaunchServices so the system converges on a single app.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const MAC_BUNDLE_ID = 'ai.deepseek.oh-dsh-desktop'

/** Every bundle file name the packaged macOS app has shipped under. */
export const MAC_BUNDLE_NAMES = [
  'Oh-DSH-Desktop.app',
  'Oh-DSH Desktop.app',
] as const

const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

/** Compare dotted version strings numerically; returns -1, 0, or 1. */
export function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(part => Number.parseInt(part, 10) || 0)
  const rightParts = right.split('.').map(part => Number.parseInt(part, 10) || 0)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

/** Read one Info.plist string key from a macOS application bundle. */
export interface BundleProbe {
  bundleIdentifier(bundlePath: string): Promise<string | null>
  shortVersion(bundlePath: string): Promise<string | null>
}

async function readPlistString(bundlePath: string, key: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/plutil', [
      '-extract',
      key,
      'raw',
      '-o',
      '-',
      join(bundlePath, 'Contents', 'Info.plist'),
    ], { timeout: 5000 })
    const value = stdout.trim()
    return value === '' ? null : value
  } catch {
    return null
  }
}

export const plutilBundleProbe: BundleProbe = {
  bundleIdentifier: bundlePath => readPlistString(bundlePath, 'CFBundleIdentifier'),
  shortVersion: bundlePath => readPlistString(bundlePath, 'CFBundleShortVersionString'),
}

export interface StaleMacBundle {
  path: string
  version: string
}

export interface FindStaleMacBundlesOptions {
  applicationsDir: string
  runningBundlePath: string
  runningVersion: string
  bundleId?: string
  bundleNames?: readonly string[]
  probe?: BundleProbe
}

/**
 * List sibling bundles under the given Applications directory that share the
 * running app's bundle identifier but are strictly older. The running bundle
 * itself and unrelated bundles are never returned.
 */
export interface FindStaleMacBundlesResult {
  /** Same-identifier siblings that are strictly older than the running version. */
  stale: StaleMacBundle[]
  /**
   * Same-identifier siblings whose version could not be read. They are never
   * retired: an unknown version must not count as evidence of being older.
   */
  unverifiable: string[]
}

/**
 * Scan the given Applications directory for sibling bundles that share the
 * running app's bundle identifier but are strictly older. The running bundle
 * itself and unrelated bundles are never returned, and a bundle whose version
 * cannot be verified is reported under `unverifiable` instead of being
 * classified by age.
 */
export async function findStaleMacBundles(options: FindStaleMacBundlesOptions): Promise<FindStaleMacBundlesResult> {
  const bundleId = options.bundleId ?? MAC_BUNDLE_ID
  const bundleNames = options.bundleNames ?? MAC_BUNDLE_NAMES
  const probe = options.probe ?? plutilBundleProbe
  const running = resolve(options.runningBundlePath)
  const result: FindStaleMacBundlesResult = { stale: [], unverifiable: [] }
  for (const name of bundleNames) {
    const candidate = resolve(join(options.applicationsDir, name))
    if (candidate === running) continue
    if (!existsSync(candidate)) continue
    const identifier = await probe.bundleIdentifier(candidate)
    if (identifier !== bundleId) continue
    const version = await probe.shortVersion(candidate)
    if (version === null) {
      result.unverifiable.push(candidate)
      continue
    }
    if (compareVersions(version, options.runningVersion) >= 0) continue
    result.stale.push({ path: candidate, version })
  }
  return result
}

function timestamp(date = new Date()): string {
  const part = (value: number) => String(value).padStart(2, '0')
  return [
    String(date.getFullYear()),
    part(date.getMonth() + 1),
    part(date.getDate()),
    '-',
    part(date.getHours()),
    part(date.getMinutes()),
    part(date.getSeconds()),
  ].join('')
}

function reserveTrashPath(trashDirectory: string, bundlePath: string): string {
  const stem = `${basename(bundlePath, '.app')}-before-${timestamp()}`
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const name = suffix === 0 ? `${stem}.app` : `${stem}-${String(suffix)}.app`
    const candidate = join(trashDirectory, name)
    if (!existsSync(candidate)) return candidate
  }
  throw new Error(`unable to reserve a Trash path for ${bundlePath}`)
}

async function runLsRegister(...args: string[]): Promise<void> {
  try {
    await execFileAsync(LSREGISTER, args, { timeout: 5000 })
  } catch {
    // LaunchServices rescans on its own; registration is best effort.
  }
}

export interface RetireStaleMacBundlesOptions {
  applicationsDir?: string
  trashDirectory?: string
  runningBundlePath: string
  runningVersion: string
  bundleId?: string
  bundleNames?: readonly string[]
  probe?: BundleProbe
}

export interface RetiredMacBundle extends StaleMacBundle {
  trashPath: string
}

export interface RetireStaleMacBundlesResult {
  retired: RetiredMacBundle[]
  failures: string[]
}

/**
 * Move strictly older sibling bundles with the same bundle identifier to the
 * Trash and re-register the running bundle with LaunchServices. Each bundle
 * is handled independently: a failure to retire one never aborts the others.
 * A sibling whose version cannot be verified is reported as a failure and
 * left in place.
 */
export async function retireStaleMacBundles(options: RetireStaleMacBundlesOptions): Promise<RetireStaleMacBundlesResult> {
  const applicationsDir = options.applicationsDir ?? '/Applications'
  const trashDirectory = options.trashDirectory ?? join(homedir(), '.Trash')
  const scan = await findStaleMacBundles({
    applicationsDir,
    runningBundlePath: options.runningBundlePath,
    runningVersion: options.runningVersion,
    ...(options.bundleId === undefined ? {} : { bundleId: options.bundleId }),
    ...(options.bundleNames === undefined ? {} : { bundleNames: options.bundleNames }),
    ...(options.probe === undefined ? {} : { probe: options.probe }),
  })
  const retired: RetiredMacBundle[] = []
  const failures: string[] = scan.unverifiable.map(path => (
    `${path}: bundle version could not be verified; left in place`
  ))
  for (const bundle of scan.stale) {
    try {
      const trashPath = reserveTrashPath(trashDirectory, bundle.path)
      // Unregister the stale path first so LaunchServices does not keep
      // resolving the old location, then move the bundle out of Applications.
      await runLsRegister('-u', bundle.path)
      mkdirSync(trashDirectory, { recursive: true })
      renameSync(bundle.path, trashPath)
      retired.push({ ...bundle, trashPath })
    } catch (error) {
      failures.push(`${bundle.path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (retired.length > 0) {
    await runLsRegister('-f', resolve(options.runningBundlePath))
  }
  return { retired, failures }
}
