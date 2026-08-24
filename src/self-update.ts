/** Startup self-update checks and installer-driven upgrades for Oh-DSH. */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gt, valid } from 'semver'

export const OFFICIAL_REPOSITORY = 'hust-open-atom-club/oh-dsh'
export const UPDATE_CHECK_DISABLE_ENV = 'OH_DSH_UPDATE_CHECK'
export const UPDATE_API_BASE_ENV = 'OH_DSH_UPDATE_API_BASE'
const UPDATE_CHECK_TIMEOUT_MS = 5_000
const STARTUP_NOTICE_BUDGET_MS = 1_500

export interface UpdateCheckResult {
  current: string
  latest: string
  updateAvailable: boolean
}

export type UpdateFetcher = typeof fetch

/** True unless the user opted out with OH_DSH_UPDATE_CHECK=0|false. */
export function updateCheckEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env[UPDATE_CHECK_DISABLE_ENV]
  if (value === undefined || value === '') return true
  return !(value === '0' || value.toLowerCase() === 'false')
}

export function latestReleaseApiUrl(env: NodeJS.ProcessEnv): string {
  const base = env[UPDATE_API_BASE_ENV]?.replace(/\/+$/, '')
  if (base !== undefined && base !== '') {
    return `${base}/repos/${OFFICIAL_REPOSITORY}/releases/latest`
  }
  return `https://api.github.com/repos/${OFFICIAL_REPOSITORY}/releases/latest`
}

/**
 * Resolve the latest stable release version, or undefined when the check
 * fails, is disabled, or returns something that is not a stable tag.
 */
export async function fetchLatestVersion(
  env: NodeJS.ProcessEnv,
  fetchImpl: UpdateFetcher = fetch,
): Promise<string | undefined> {
  if (!updateCheckEnabled(env)) return undefined
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'oh-dsh-update-check',
  }
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN
  if (token !== undefined && token !== '') {
    headers.authorization = `Bearer ${token}`
  }
  try {
    const response = await fetchImpl(latestReleaseApiUrl(env), {
      headers,
      signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    const release = await response.json() as { tag_name?: unknown }
    if (typeof release.tag_name !== 'string') return undefined
    const version = valid(release.tag_name.replace(/^v/, ''))
    return version ?? undefined
  } catch {
    return undefined
  }
}

/** Compare the running version with the latest stable release. */
export async function checkForUpdate(
  current: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: UpdateFetcher = fetch,
): Promise<UpdateCheckResult | undefined> {
  const normalizedCurrent = valid(current) ?? undefined
  if (normalizedCurrent === undefined) return undefined
  const latest = await fetchLatestVersion(env, fetchImpl)
  if (latest === undefined) return undefined
  return {
    current: normalizedCurrent,
    latest,
    updateAvailable: gt(latest, normalizedCurrent),
  }
}

/** One startup notice line, codex-TUI style. */
export function formatUpdateNotice(result: UpdateCheckResult): string {
  return `Oh-DSH ${result.current} -> ${result.latest} is available. Run "ohdsh update" to upgrade.\n`
}

/**
 * Await one startup check with a short budget so surfaces never wait on a
 * slow network: past the budget the check is abandoned silently.
 */
export async function startupUpdateNotice(
  current: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: UpdateFetcher = fetch,
): Promise<string | undefined> {
  if (!updateCheckEnabled(env)) return undefined
  const check = checkForUpdate(current, env, fetchImpl)
  const budget = new Promise<undefined>(resolve => {
    setTimeout(resolve, STARTUP_NOTICE_BUDGET_MS)
  })
  const result = await Promise.race([check, budget])
  if (result === undefined || !result.updateAvailable) return undefined
  return formatUpdateNotice(result)
}

/** Raw installer-script URL for the current platform. */
export function installScriptUrl(
  platform: NodeJS.Platform = process.platform,
  repository: string = OFFICIAL_REPOSITORY,
  env: NodeJS.ProcessEnv = {},
): string {
  const override = env.OH_DSH_INSTALL_SCRIPT_URL
  if (override !== undefined && override !== '') return override
  const script = platform === 'win32' ? 'install.ps1' : 'install.sh'
  return `https://raw.githubusercontent.com/${repository}/main/${script}`
}

/** Which distribution layout the launcher is running from. */
export function detectDistributionSurface(
  root: string,
  env: NodeJS.ProcessEnv,
  pathExists: (path: string) => boolean = existsSync,
): 'desktop' | 'web' | 'tui' | 'source' {
  if (env.OH_DSH_DESKTOP_APP !== undefined && env.OH_DSH_DESKTOP_APP !== '') {
    return 'desktop'
  }
  const packaged = env.DSH_OH_TUI_ROOT !== undefined || env.DSH_OH_WEB_ROOT !== undefined
  if (env.OH_DSH_SOURCE_ROOT !== undefined && env.OH_DSH_SOURCE_ROOT !== '' && !packaged) {
    return 'source'
  }
  if (pathExists(join(root, 'lib', 'oh-dsh-web', 'main.js'))) return 'web'
  if (pathExists(join(root, 'lib', 'oh-dsh', 'cli.js'))) return 'tui'
  return packaged ? 'tui' : 'source'
}

/** The command line that upgrades one surface with the platform installer. */
export function selfUpdatePlan(
  surface: 'web' | 'tui',
  platform: NodeJS.Platform = process.platform,
  repository: string = OFFICIAL_REPOSITORY,
  env: NodeJS.ProcessEnv = {},
): { scriptUrl: string; command: string; args: string[] } {
  const scriptUrl = installScriptUrl(platform, repository, env)
  if (platform === 'win32') {
    return {
      scriptUrl,
      command: 'powershell',
      args: [
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', '<script>', '-Surface', surface,
      ],
    }
  }
  return {
    scriptUrl,
    command: 'sh',
    args: ['<script>', '--surface', surface],
  }
}

/** Download the installer script and run it for one surface. */
export async function runSelfUpdate(
  surface: 'web' | 'tui',
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  fetchImpl: UpdateFetcher = fetch,
): Promise<number> {
  const plan = selfUpdatePlan(surface, platform, OFFICIAL_REPOSITORY, env)
  let script: string
  try {
    const response = await fetchImpl(plan.scriptUrl)
    if (!response.ok) {
      throw new Error(`unexpected status ${String(response.status)}`)
    }
    script = await response.text()
  } catch (error) {
    throw new Error(
      `failed to download the installer from ${plan.scriptUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  const workdir = mkdtempSync(join(tmpdir(), 'oh-dsh-self-update-'))
  const scriptPath = join(
    workdir,
    platform === 'win32' ? 'install.ps1' : 'install.sh',
  )
  try {
    writeFileSync(scriptPath, script, { mode: 0o755 })
    const args = plan.args.map(arg => (arg === '<script>' ? scriptPath : arg))
    return await new Promise<number>((resolve, reject) => {
      const child = spawn(plan.command, args, {
        env,
        stdio: 'inherit',
        ...(platform === 'win32' ? { windowsHide: true } : {}),
      })
      child.once('error', reject)
      child.once('exit', code => {
        resolve(code ?? 1)
      })
    })
  } finally {
    rmSync(workdir, { force: true, recursive: true })
  }
}
