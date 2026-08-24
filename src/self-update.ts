/** Startup self-update checks and installer-driven upgrades for Oh-DSH. */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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

export function latestReleaseApiUrl(
  env: NodeJS.ProcessEnv,
  repository: string = OFFICIAL_REPOSITORY,
): string {
  const base = env[UPDATE_API_BASE_ENV]?.replace(/\/+$/, '')
  if (base !== undefined && base !== '') {
    return `${base}/repos/${repository}/releases/latest`
  }
  return `https://api.github.com/repos/${repository}/releases/latest`
}

/**
 * Resolve the latest stable release version, or undefined when the check
 * fails, is disabled, or returns something that is not a stable tag. Updates
 * are release-based only: no commit-level or rolling channel is consulted.
 */
export async function fetchLatestVersion(
  env: NodeJS.ProcessEnv,
  fetchImpl: UpdateFetcher = fetch,
  repository: string = OFFICIAL_REPOSITORY,
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
    const response = await fetchImpl(latestReleaseApiUrl(env, repository), {
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
  repository: string = OFFICIAL_REPOSITORY,
): Promise<UpdateCheckResult | undefined> {
  const normalizedCurrent = valid(current) ?? undefined
  if (normalizedCurrent === undefined) return undefined
  const latest = await fetchLatestVersion(env, fetchImpl, repository)
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
  repository: string = OFFICIAL_REPOSITORY,
): Promise<string | undefined> {
  if (!updateCheckEnabled(env)) return undefined
  const check = checkForUpdate(current, env, fetchImpl, repository)
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

/**
 * Installer bookkeeping root (launcher records, desktop markers): under the
 * shared Oh-DSH state root owned by src/data-root.ts, so one OH_DSH_HOME
 * override moves every record together with the app's shared state.
 */
export function installerRecordHome(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  // install.ps1 derives the default state root from USERPROFILE; follow the
  // same variable so a HOME set by Git Bash cannot split the two roots.
  const userHome = platform === 'win32'
    ? env.USERPROFILE ?? homedir()
    : env.HOME ?? homedir()
  const stateRoot = env.OH_DSH_HOME !== undefined && env.OH_DSH_HOME !== ''
    ? env.OH_DSH_HOME
    : join(userHome, '.ohdsh')
  return join(stateRoot, 'installer')
}

/**
 * Default payload destinations the installers own (programs, not state):
 * XDG data home on Unix, %LOCALAPPDATA% on Windows.
 */
export function installerPayloadHome(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA
    if (localAppData !== undefined && localAppData !== '') {
      return join(localAppData, 'oh-dsh')
    }
    return join(env.USERPROFILE ?? homedir(), 'AppData', 'Local', 'oh-dsh')
  }
  const xdgDataHome = env.XDG_DATA_HOME
  if (xdgDataHome !== undefined && xdgDataHome !== '') {
    return join(xdgDataHome, 'oh-dsh')
  }
  // install.sh derives this from $HOME; honor the same override here.
  return join(env.HOME ?? homedir(), '.local', 'share', 'oh-dsh')
}

export interface LauncherRecord {
  webDest?: string
  tuiDest?: string
  binDir?: string
  /** Per-surface fork provenance: repositories each payload came from. */
  webRepo?: string
  tuiRepo?: string
}

function readTextAt(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Read the launcher destinations the installers record, codex-style: the
 * records plus the running path decide how a self-update must run. Parsing
 * is inert line matching; the file is never evaluated.
 */
export function readLauncherRecord(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  readFile: (path: string) => string | undefined = readTextAt,
): LauncherRecord {
  const content = readFile(join(installerRecordHome(platform, env), 'launcher.env'))
  if (content === undefined) return {}
  const record: LauncherRecord = {}
  // Line values tolerate CRLF and a UTF-8 BOM: install.ps1 writes Windows
  // line endings and PowerShell 5.1 UTF-8 output starts with a BOM.
  const normalized = content.startsWith('\uFEFF') ? content.slice(1) : content
  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.startsWith('WEB_DEST=')) record.webDest = line.slice('WEB_DEST='.length)
    else if (line.startsWith('TUI_DEST=')) record.tuiDest = line.slice('TUI_DEST='.length)
    else if (line.startsWith('BIN_DIR=')) record.binDir = line.slice('BIN_DIR='.length)
    else if (line.startsWith('WEB_REPO=')) record.webRepo = line.slice('WEB_REPO='.length)
    else if (line.startsWith('TUI_REPO=')) record.tuiRepo = line.slice('TUI_REPO='.length)
  }
  return record
}

function markerSurface(root: string): 'web' | 'tui' | undefined {
  const raw = readTextAt(join(root, '.oh-dsh-install.env'))
  if (raw === undefined) return undefined
  const content = raw.startsWith('\uFEFF') ? raw.slice(1) : raw
  for (const rawLine of content.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line.startsWith('OH_DSH_INSTALL_SURFACE=')) continue
    const value = line.slice('OH_DSH_INSTALL_SURFACE='.length)
    return value === 'web' || value === 'tui' ? value : undefined
  }
  return undefined
}

/**
 * Decide which distribution the launcher is running from. Like codex, infer
 * from the install records and the path itself; no build flag marks the
 * source. Order: the payload's own install marker, the desktop bundle path,
 * the source-root contract, the installer's default payload paths, the
 * launcher destination records, then the payload layout for manually
 * extracted archives.
 */
export function detectDistributionSurface(
  root: string,
  env: NodeJS.ProcessEnv,
  pathExists: (path: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
): 'desktop' | 'web' | 'tui' | 'source' {
  const target = resolve(root)

  const marked = markerSurface(target)
  if (marked !== undefined) return marked

  if (platform === 'darwin'
    && target.split(/[\\/]/).join('/').includes('.app/Contents/Resources')) {
    return 'desktop'
  }
  if (env.OH_DSH_DESKTOP_APP !== undefined && env.OH_DSH_DESKTOP_APP !== '') return 'desktop'

  const sourceRoot = env.OH_DSH_SOURCE_ROOT
  const packaged = (env.DSH_OH_TUI_ROOT !== undefined && env.DSH_OH_TUI_ROOT !== '')
    || (env.DSH_OH_WEB_ROOT !== undefined && env.DSH_OH_WEB_ROOT !== '')
  if (sourceRoot !== undefined && sourceRoot !== '' && !packaged) return 'source'

  const payloadHome = installerPayloadHome(platform, env)
  if (target === resolve(join(payloadHome, 'web'))) return 'web'
  if (target === resolve(join(payloadHome, 'tui'))) return 'tui'

  const record = readLauncherRecord(env, platform)
  if (record.webDest !== undefined && record.webDest !== '' && target === resolve(record.webDest)) {
    return 'web'
  }
  if (record.tuiDest !== undefined && record.tuiDest !== '' && target === resolve(record.tuiDest)) {
    return 'tui'
  }

  if (pathExists(join(target, 'lib', 'oh-dsh-web', 'main.js'))) return 'web'
  if (pathExists(join(target, 'lib', 'oh-dsh', 'cli.js'))) return 'tui'
  return 'source'
}

/** The command line that upgrades one surface with the platform installer. */
export interface SelfUpdatePlan {
  scriptUrl: string
  command: string
  args: string[]
  /** Destination overrides reconstructed from the installer records. */
  dest?: string
  binDir?: string
}

export function selfUpdatePlan(
  surface: 'web' | 'tui',
  platform: NodeJS.Platform = process.platform,
  repository: string = OFFICIAL_REPOSITORY,
  env: NodeJS.ProcessEnv = {},
): SelfUpdatePlan {
  const record = readLauncherRecord(env, platform)
  // Fork installs keep their provenance per surface: the record decides
  // which repository both the script download and the release resolution
  // target, so side-by-side installs from different forks stay separate.
  const recordRepo = surface === 'web' ? record.webRepo : record.tuiRepo
  const effectiveRepo = recordRepo !== undefined && recordRepo !== ''
    ? recordRepo
    : repository
  const scriptUrl = installScriptUrl(platform, effectiveRepo, env)
  const dest = surface === 'web' ? record.webDest : record.tuiDest
  const repoArgs = recordRepo !== undefined && recordRepo !== '' && recordRepo !== repository
    ? platform === 'win32' ? ['-Repo', recordRepo] : ['--repo', recordRepo]
    : []
  if (platform === 'win32') {
    const args = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', '<script>', '-Surface', surface,
    ]
    if (dest !== undefined && dest !== '') args.push('-Dest', dest)
    if (record.binDir !== undefined && record.binDir !== '') {
      args.push('-BinDir', record.binDir)
    }
    args.push(...repoArgs)
    return { scriptUrl, command: 'powershell', args }
  }
  const args = ['<script>', '--surface', surface]
  if (dest !== undefined && dest !== '') args.push('--dest', dest)
  if (record.binDir !== undefined && record.binDir !== '') {
    args.push('--bin-dir', record.binDir)
  }
  args.push(...repoArgs)
  return { scriptUrl, command: 'sh', args }
}

/**
 * Verify the running root is a location the installer owns (its recorded or
 * default destination), so an update never silently installs somewhere else.
 */
export function installerOwnsRoot(
  root: string,
  surface: 'web' | 'tui',
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const target = resolve(root)
  if (markerSurface(target) === surface) return true
  const payloadHome = installerPayloadHome(platform, env)
  if (target === resolve(join(payloadHome, surface))) return true
  const record = readLauncherRecord(env, platform)
  const recorded = surface === 'web' ? record.webDest : record.tuiDest
  return recorded !== undefined && recorded !== '' && target === resolve(recorded)
}

/** Whether an installer-owned installation of one surface exists anywhere. */
export function surfaceIsInstalled(
  surface: 'web' | 'tui',
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  pathExists: (path: string) => boolean = existsSync,
): boolean {
  const record = readLauncherRecord(env, platform)
  const recorded = surface === 'web' ? record.webDest : record.tuiDest
  if (recorded !== undefined && recorded !== '') {
    return pathExists(join(recorded, 'bin', 'ohdsh'))
  }
  return pathExists(join(installerPayloadHome(platform, env), surface, 'bin', 'ohdsh'))
}

/**
 * The install script bundled into web/tui packages at lib/oh-dsh/. `ohdsh
 * update` prefers it over a download, so the upgrade runs the script that
 * matches the installed version and works without raw.githubusercontent.
 */
export function bundledInstallScript(
  root: string,
  platform: NodeJS.Platform = process.platform,
  pathExists: (path: string) => boolean = existsSync,
): string | undefined {
  const script = join(
    root,
    'lib',
    'oh-dsh',
    platform === 'win32' ? 'install.ps1' : 'install.sh',
  )
  return pathExists(script) ? script : undefined
}

function windowsQuoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * On Windows the packaged CLI runs from the payload being replaced, and a
 * mapped node.exe cannot be moved while this process lives. Hand the work to
 * a detached helper that waits for this process to exit, then runs the
 * installer on its own.
 */
function spawnDetachedWindowsUpdate(
  scriptPath: string,
  plan: SelfUpdatePlan,
  env: NodeJS.ProcessEnv,
): number {
  const flags = plan.args
    .filter(arg => arg !== '-NoProfile' && arg !== '-ExecutionPolicy'
      && arg !== 'Bypass' && arg !== '-File' && arg !== '<script>')
    .map(arg => (arg.startsWith('-') ? arg : windowsQuoted(arg)))
    .join(' ')
  const escapedScript = windowsQuoted(scriptPath)
  const waitAndRun = [
    `while (Get-Process -Id ${String(process.pid)} -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 250 }`,
    `& ${escapedScript} ${flags}`,
  ].join('; ')
  const child = spawn(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', waitAndRun],
    { detached: true, stdio: 'ignore', env, windowsHide: true },
  )
  child.unref()
  process.stdout.write(
    'Oh-DSH: the upgrade continues in the background after this process exits.\n',
  )
  return 0
}

/**
 * Run the installer for one surface. The script bundled with the running
 * package is preferred; otherwise it is downloaded over TLS. On Windows the
 * installer runs detached after this process exits (see above).
 */
export async function runSelfUpdate(
  surface: 'web' | 'tui',
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  fetchImpl: UpdateFetcher = fetch,
  root: string = '',
): Promise<number> {
  const plan = selfUpdatePlan(surface, platform, OFFICIAL_REPOSITORY, env)
  const bundled = root !== '' ? bundledInstallScript(root, platform) : undefined
  if (platform === 'win32') {
    const scriptPath = bundled ?? join(
      installerRecordHome(platform, env),
      'update-install.ps1',
    )
    if (bundled === undefined) {
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
      mkdirSync(installerRecordHome(platform, env), { recursive: true })
      writeFileSync(scriptPath, script, { mode: 0o755 })
    }
    return spawnDetachedWindowsUpdate(scriptPath, plan, env)
  }
  let scriptPath = bundled
  let workdir = ''
  if (scriptPath === undefined) {
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
    workdir = mkdtempSync(join(tmpdir(), 'oh-dsh-self-update-'))
    scriptPath = join(workdir, 'install.sh')
    writeFileSync(scriptPath, script, { mode: 0o755 })
  }
  try {
    const args = plan.args.map(arg => (arg === '<script>' ? scriptPath : arg))
    return await new Promise<number>((resolve, reject) => {
      const child = spawn(plan.command, args, {
        env,
        stdio: 'inherit',
      })
      child.once('error', reject)
      child.once('exit', code => {
        resolve(code ?? 1)
      })
    })
  } finally {
    if (workdir !== '') rmSync(workdir, { force: true, recursive: true })
  }
}
