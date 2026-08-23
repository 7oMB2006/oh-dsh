/**
 * In-app DSH runtime updates, decoupled from Desktop application releases.
 *
 * The bundled `dsh-runtime` ships with the application; a newer runtime
 * published as a `oh-dsh-runtime-<dshVersion>-<platform>-<arch>.tar.gz`
 * release asset can be downloaded, integrity-checked, staged under
 * `~/.ohdsh/runtimes/<version>/`, smoke-verified, and activated through the
 * pointer file `~/.ohdsh/runtimes/current.json`. The supervisor restart then
 * picks up the staged runtime; removing the pointer rolls back to the
 * bundled one.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const RUNTIME_UPDATE_REPOSITORY = 'hust-open-atom-club/oh-dsh'
export const RUNTIME_BUNDLE_PREFIX = 'oh-dsh-runtime-'
export const RUNTIME_POINTER_FILE = 'current.json'
export const RUNTIMES_DIRECTORY = 'runtimes'
/** Compatibility manifest shipped at the root of every runtime bundle. */
export const RUNTIME_BUNDLE_MANIFEST = 'oh-dsh-runtime-manifest.json'

export interface RuntimeBundleManifest {
  bundledByAppVersion: string
  dshVersion: string
  /**
   * Explicit runtime-boundary contract revision of the producing tree.
   * The bundle embeds this project's surface plugins and adapters, so a
   * running application may only install bundles whose contract revision
   * matches its own; application package versions do not encode this.
   */
  runtimeContract: number
}

export interface RuntimeBundleCandidate {
  dshVersion: string
  fileName: string
  downloadUrl: string
  size: number | null
  releaseUrl: string
  releaseName: string | null
  releaseNotes: string
}

export type RuntimeUpdateState =
  | { status: 'idle'; currentVersion: string; bundledVersion: string; candidate: RuntimeBundleCandidate | null }
  | { status: 'checking'; currentVersion: string; bundledVersion: string }
  | { status: 'not-available'; currentVersion: string; bundledVersion: string }
  | { status: 'available'; currentVersion: string; bundledVersion: string; candidate: RuntimeBundleCandidate }
  | {
    status: 'downloading'
    currentVersion: string
    bundledVersion: string
    candidate: RuntimeBundleCandidate
    transferred: number
    total: number | null
  }
  | { status: 'staging'; currentVersion: string; bundledVersion: string; candidate: RuntimeBundleCandidate; stage: 'extract' | 'verify' | 'activate' }
  | { status: 'installed'; currentVersion: string; bundledVersion: string; previousVersion: string }
  | { status: 'rolled-back'; currentVersion: string; bundledVersion: string }
  | { status: 'error'; currentVersion: string; bundledVersion: string; stage: 'check' | 'download' | 'verify' | 'extract' | 'activate'; message: string; retryable: boolean }

export type RuntimeUpdateCommand = { type: 'check' } | { type: 'install' } | { type: 'rollback' }

/** Compare two DSH release versions, e.g. `0.1.0-rc.7` < `0.1.1-rc.2` < `0.1.1`. */
export function compareDshVersions(left: string, right: string): number {
  const parse = (value: string): { core: number[]; pre: number[] | null } => {
    const [coreText, preText] = value.split('-', 2)
    const core = coreText?.split('.').map(part => Number.parseInt(part, 10)) ?? [0]
    const pre = preText === undefined
      ? null
      : preText.split('.').map(part => {
        const numeric = Number.parseInt(part, 10)
        return Number.isNaN(numeric) ? 0 : numeric
      })
    return { core, pre }
  }
  const a = parse(left)
  const b = parse(right)
  const length = Math.max(a.core.length, b.core.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0)
    if (difference !== 0) return difference
  }
  // A release without a prerelease suffix outranks its rc line.
  if (a.pre === null && b.pre === null) return 0
  if (a.pre === null) return 1
  if (b.pre === null) return -1
  const preLength = Math.max(a.pre.length, b.pre.length)
  for (let index = 0; index < preLength; index += 1) {
    const difference = (a.pre[index] ?? 0) - (b.pre[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/** Match one release asset against the runtime-bundle naming contract. */
export function parseRuntimeBundleAsset(
  fileName: string,
  platform: NodeJS.Platform,
  arch: string,
): string | null {
  const escaped = `${RUNTIME_BUNDLE_PREFIX}(.+)-${platform}-${arch}.tar.gz`
  const match = new RegExp(`^${escaped}$`).exec(fileName)
  const dshVersion = match?.[1]
  return dshVersion === undefined || dshVersion === '' ? null : dshVersion
}

interface ReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

interface Release {
  tag_name: string
  name: string | null
  body: string | null
  html_url: string
  prerelease: boolean
  assets: ReleaseAsset[]
}

export interface RuntimeUpdateManagerOptions {
  /** Version of the currently active runtime (`dsh-runtime/package.json`). */
  currentVersion: string
  /** Version of the runtime bundled with the application build. */
  bundledVersion: string
  /** Shared Oh-DSH data root (`~/.ohdsh`); staged runtimes live beneath it. */
  dataRoot: string
  /** Bundled Node binary used to smoke-verify a staged runtime. */
  nodeBinary: string
  /**
   * Runtime-boundary contract revision this application declares. A bundle
   * is installable only when its manifest declares the same revision.
   */
  runtimeContract: number
  platform?: NodeJS.Platform
  arch?: string
  /** GitHub releases API base; overridable for tests. */
  releasesUrl?: string
  fetchImpl?: typeof fetch
  runCommand?: (file: string, args: string[], options: { cwd?: string }) => Promise<{ stdout: string; stderr: string }>
  onState?: (state: RuntimeUpdateState) => void
  /** Called after the pointer changed so the supervisor can be restarted. */
  onRuntimeChanged?: () => Promise<void> | void
  onLog?: (message: string) => void
}

export class RuntimeUpdateManager {
  readonly #options: Omit<RuntimeUpdateManagerOptions, 'platform' | 'arch'> & { platform: NodeJS.Platform; arch: string }
  #state: RuntimeUpdateState
  #candidate: RuntimeBundleCandidate | null = null
  #busy = false

  constructor(options: RuntimeUpdateManagerOptions) {
    this.#options = { platform: process.platform, arch: process.arch, ...options }
    this.#state = {
      status: 'idle',
      bundledVersion: options.bundledVersion,
      candidate: null,
      currentVersion: options.currentVersion,
    }
  }

  getState(): RuntimeUpdateState {
    return this.#state
  }

  refreshVersions(currentVersion: string): void {
    this.#options.currentVersion = currentVersion
  }

  async command(command: RuntimeUpdateCommand): Promise<RuntimeUpdateState> {
    if (command.type === 'check') return await this.#check()
    if (command.type === 'install') return await this.#install()
    return await this.#rollback()
  }

  #setState(state: RuntimeUpdateState): void {
    this.#state = state
    this.#options.onState?.(state)
  }

  #fail(stage: 'check' | 'download' | 'verify' | 'extract' | 'activate', message: string, retryable: boolean): void {
    this.#busy = false
    this.#setState({
      status: 'error',
      bundledVersion: this.#options.bundledVersion,
      currentVersion: this.#options.currentVersion,
      message,
      retryable,
      stage,
    })
  }

  async #check(): Promise<RuntimeUpdateState> {
    if (this.#busy) return this.#state
    this.#busy = true
    this.#setState({ status: 'checking', bundledVersion: this.#options.bundledVersion, currentVersion: this.#options.currentVersion })
    try {
      const fetchImpl = this.#options.fetchImpl ?? fetch
      const url = this.#options.releasesUrl ?? `https://api.github.com/repos/${RUNTIME_UPDATE_REPOSITORY}/releases?per_page=30`
      const response = await fetchImpl(url, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'oh-dsh-desktop' },
      })
      if (!response.ok) throw new Error(`release lookup failed with HTTP ${String(response.status)}`)
      const releases = await response.json() as Release[]
      if (!Array.isArray(releases)) throw new Error('release lookup returned an unexpected document')
      let candidate: RuntimeBundleCandidate | null = null
      for (const release of releases) {
        for (const asset of release.assets ?? []) {
          const dshVersion = parseRuntimeBundleAsset(asset.name, this.#options.platform, this.#options.arch)
          if (dshVersion === null) continue
          if (compareDshVersions(dshVersion, this.#options.currentVersion) <= 0) continue
          if (candidate !== null && compareDshVersions(dshVersion, candidate.dshVersion) <= 0) continue
          candidate = {
            dshVersion,
            downloadUrl: asset.browser_download_url,
            fileName: asset.name,
            releaseName: release.name,
            releaseNotes: release.body ?? '',
            releaseUrl: release.html_url,
            size: asset.size ?? null,
          }
        }
      }
      this.#candidate = candidate
      this.#busy = false
      if (candidate === null) {
        this.#setState({ status: 'not-available', bundledVersion: this.#options.bundledVersion, currentVersion: this.#options.currentVersion })
        return this.#state
      }
      this.#setState({
        status: 'available',
        bundledVersion: this.#options.bundledVersion,
        candidate,
        currentVersion: this.#options.currentVersion,
      })
      return this.#state
    } catch (error) {
      this.#fail('check', error instanceof Error ? error.message : String(error), true)
      return this.#state
    }
  }

  async #install(): Promise<RuntimeUpdateState> {
    if (this.#busy) return this.#state
    if (this.#candidate === null) {
      await this.#check()
      if (this.#candidate === null) return this.#state
    }
    const candidate = this.#candidate
    this.#busy = true
    const previousVersion = this.#options.currentVersion
    // The shared catch reports where the transaction actually failed and
    // whether trying again can plausibly help.
    let stage: 'download' | 'verify' | 'extract' | 'activate' = 'download'
    let retryable = true
    try {
      const updateRoot = join(this.#options.dataRoot, RUNTIMES_DIRECTORY)
      const downloadsRoot = join(updateRoot, 'downloads')
      mkdirSync(downloadsRoot, { recursive: true })
      const archivePath = join(downloadsRoot, candidate.fileName)

      this.#setState({ status: 'downloading', bundledVersion: this.#options.bundledVersion, candidate, currentVersion: this.#options.currentVersion, total: candidate.size, transferred: 0 })
      const fetchImpl = this.#options.fetchImpl ?? fetch
      const response = await fetchImpl(candidate.downloadUrl)
      if (!response.ok) throw new Error(`bundle download failed with HTTP ${String(response.status)}`)
      const total = response.headers.get('content-length') !== null ? Number(response.headers.get('content-length')) : candidate.size
      const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
      let transferred = 0
      body.on('data', (chunk: Buffer) => {
        transferred += chunk.length
        this.#setState({ status: 'downloading', bundledVersion: this.#options.bundledVersion, candidate, currentVersion: this.#options.currentVersion, total, transferred })
      })
      await pipeline(body, createWriteStream(archivePath))

      stage = 'verify'
      this.#setState({ status: 'staging', bundledVersion: this.#options.bundledVersion, candidate, currentVersion: this.#options.currentVersion, stage: 'verify' })
      const expectedHash = await this.#downloadSha256(candidate)
      const actualHash = await sha256File(archivePath)
      if (expectedHash !== null && expectedHash !== actualHash) {
        throw new Error(`runtime bundle integrity mismatch: expected ${expectedHash}, received ${actualHash}`)
      }

      stage = 'extract'
      this.#setState({ status: 'staging', bundledVersion: this.#options.bundledVersion, candidate, currentVersion: this.#options.currentVersion, stage: 'extract' })
      const stageRoot = join(updateRoot, candidate.dshVersion)
      rmSync(stageRoot, { recursive: true, force: true })
      mkdirSync(stageRoot, { recursive: true })
      const run = this.#options.runCommand ?? defaultRunCommand
      await run(tarBinary(this.#options.platform), ['-xzf', archivePath, '-C', stageRoot], {})
      const stageRootAbs = stageRoot
      const manifestPath = join(stageRootAbs, RUNTIME_BUNDLE_MANIFEST)
      if (!existsSync(manifestPath)) {
        throw new Error('runtime bundle is missing its compatibility manifest')
      }
      let bundleManifest: RuntimeBundleManifest
      try {
        bundleManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RuntimeBundleManifest
      } catch (error) {
        retryable = false
        throw new Error(`runtime bundle manifest is unreadable: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (bundleManifest.dshVersion !== candidate.dshVersion) {
        retryable = false
        throw new Error(`runtime bundle manifest declares DSH ${String(bundleManifest.dshVersion)}, expected ${candidate.dshVersion}`)
      }
      if (bundleManifest.runtimeContract !== this.#options.runtimeContract) {
        retryable = false
        throw new Error(
          `runtime bundle targets contract revision ${String(bundleManifest.runtimeContract)}, `
          + `this application requires ${String(this.#options.runtimeContract)}; update Oh-DSH Desktop first`,
        )
      }
      const stagedRuntime = join(stageRoot, 'dsh-runtime')
      if (!existsSync(join(stagedRuntime, 'lib', 'bin.js'))) {
        throw new Error('runtime bundle did not contain a dsh-runtime/lib/bin.js entry')
      }
      const stagedManifest = JSON.parse(readFileSync(join(stagedRuntime, 'package.json'), 'utf8')) as { version?: unknown }
      if (stagedManifest.version !== candidate.dshVersion) {
        throw new Error(`runtime bundle reports version ${String(stagedManifest.version)}, expected ${candidate.dshVersion}`)
      }
      const smoke = await run(this.#options.nodeBinary, [join(stagedRuntime, 'lib', 'bin.js'), '--version'], {})
      const smokeVersion = smoke.stdout.trim()
      if (smokeVersion !== candidate.dshVersion) {
        throw new Error(`staged runtime smoke check returned ${smokeVersion}, expected ${candidate.dshVersion}`)
      }

      stage = 'activate'
      this.#setState({ status: 'staging', bundledVersion: this.#options.bundledVersion, candidate, currentVersion: this.#options.currentVersion, stage: 'activate' })
      writePointer(updateRoot, { dshRuntimeRoot: stagedRuntime, version: candidate.dshVersion })
      // Reclaiming the download archive must never turn a committed
      // activation into a reported failure (e.g. a Windows scanner EPERM).
      try {
        rmSync(downloadsRoot, { recursive: true, force: true })
      } catch (error) {
        this.#options.onLog?.(`could not clean up runtime downloads: ${error instanceof Error ? error.message : String(error)}`)
      }
      this.#options.currentVersion = candidate.dshVersion
      this.#candidate = null
      this.#busy = false
      this.#options.onLog?.(`activated DSH runtime ${candidate.dshVersion} (bundled ${this.#options.bundledVersion})`)
      this.#setState({ status: 'installed', bundledVersion: this.#options.bundledVersion, currentVersion: candidate.dshVersion, previousVersion })
      await this.#options.onRuntimeChanged?.()
      return this.#state
    } catch (error) {
      this.#fail(stage, error instanceof Error ? error.message : String(error), retryable)
      return this.#state
    }
  }

  async #downloadSha256(candidate: RuntimeBundleCandidate): Promise<string | null> {
    const fetchImpl = this.#options.fetchImpl ?? fetch
    try {
      const response = await fetchImpl(`${candidate.downloadUrl}.sha256`)
      if (!response.ok) return null
      const text = await response.text()
      return /^[0-9a-f]{64}/i.exec(text.trim())?.[0]?.toLowerCase() ?? null
    } catch {
      return null
    }
  }

  async #rollback(): Promise<RuntimeUpdateState> {
    if (this.#busy) return this.#state
    const updateRoot = join(this.#options.dataRoot, RUNTIMES_DIRECTORY)
    const pointerPath = join(updateRoot, RUNTIME_POINTER_FILE)
    if (!existsSync(pointerPath)) return this.#state
    this.#busy = true
    try {
      rmSync(pointerPath, { force: true })
      this.#options.currentVersion = this.#options.bundledVersion
      this.#candidate = null
      this.#busy = false
      this.#options.onLog?.(`rolled back to the bundled DSH runtime ${this.#options.bundledVersion}`)
      this.#setState({ status: 'rolled-back', bundledVersion: this.#options.bundledVersion, currentVersion: this.#options.bundledVersion })
      await this.#options.onRuntimeChanged?.()
      return this.#state
    } catch (error) {
      this.#fail('activate', error instanceof Error ? error.message : String(error), false)
      return this.#state
    }
  }
}

/** Pointer file content selecting the active staged runtime. */
export interface RuntimePointer {
  dshRuntimeRoot: string
  version: string
}

export function readRuntimePointer(dataRoot: string): RuntimePointer | null {
  const pointerPath = join(dataRoot, RUNTIMES_DIRECTORY, RUNTIME_POINTER_FILE)
  if (!existsSync(pointerPath)) return null
  try {
    const parsed = JSON.parse(readFileSync(pointerPath, 'utf8')) as { dshRuntimeRoot?: unknown; version?: unknown }
    if (typeof parsed.dshRuntimeRoot !== 'string' || typeof parsed.version !== 'string') return null
    return { dshRuntimeRoot: parsed.dshRuntimeRoot, version: parsed.version }
  } catch {
    return null
  }
}

/**
 * Resolve the active staged runtime root: the pointer must reference a
 * deployable runtime (lib/bin.js present, manifest version matching the
 * pointer) whose bundle declares the caller's runtime contract revision.
 * Anything else falls back to the bundled runtime — including a bundle
 * staged by an older application after a contract bump.
 */
export function resolveStagedRuntimeRoot(
  dataRoot: string,
  options: { runtimeContract?: number } = {},
): string | null {
  const pointer = readRuntimePointer(dataRoot)
  if (pointer === null) return null
  if (!existsSync(join(pointer.dshRuntimeRoot, 'lib', 'bin.js'))) return null
  try {
    const manifest = JSON.parse(readFileSync(join(pointer.dshRuntimeRoot, 'package.json'), 'utf8')) as { version?: unknown }
    if (manifest.version !== pointer.version) return null
  } catch {
    return null
  }
  if (options.runtimeContract !== undefined) {
    try {
      const bundleManifest = JSON.parse(readFileSync(
        join(dirname(pointer.dshRuntimeRoot), RUNTIME_BUNDLE_MANIFEST),
        'utf8',
      )) as RuntimeBundleManifest
      if (bundleManifest.runtimeContract !== options.runtimeContract) return null
    } catch {
      return null
    }
  }
  return pointer.dshRuntimeRoot
}

/** Persist the pointer atomically enough for a single-writer desktop. */
export function writePointer(updateRoot: string, pointer: RuntimePointer): void {
  writeFileSync(join(updateRoot, RUNTIME_POINTER_FILE), `${JSON.stringify(pointer, undefined, 2)}\n`)
}

async function defaultRunCommand(file: string, args: string[], options: { cwd?: string }): Promise<{ stdout: string; stderr: string }> {
  return await execFileAsync(file, args, { cwd: options.cwd, encoding: 'utf8', timeout: 10 * 60_000 })
}

function tarBinary(platform: NodeJS.Platform): string {
  if (platform !== 'win32') return 'tar'
  const systemTar = 'C:\\Windows\\System32\\tar.exe'
  return existsSync(systemTar) ? systemTar : 'tar'
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

/** File size helper shared with the UI (kept internal to the module). */
export function bundleSize(path: string): number | null {
  try {
    return statSync(path).size
  } catch {
    return null
  }
}
