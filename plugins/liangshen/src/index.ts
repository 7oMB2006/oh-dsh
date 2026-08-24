/** Install the built-in Liangshen Agent preset for browser surfaces. */

import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ID = 'liangshen'
const PRESET_OWNER = '@deepseek-harness-tui/dsh-tui'
const PRESET_MARKER = '.dsh-tui-managed.json'

interface PresetMarker {
  owner?: string
  preset?: string
  revision?: string
}

interface HostContext {
  logger: {
    warn(message: string): void
  }
}

export interface LiangshenInstallOptions {
  dataRoot?: string
  sourceRoot?: string
}

export const name = 'oh-dsh-liangshen'
export const inject: string[] = []

function dataRoot(): string {
  return process.env.DSH_HOME
    ?? process.env.OH_DSH_HOME
    ?? join(homedir(), '.ohdsh')
}

function packagedPresetRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'presets', PRESET_ID)
}

function readMarker(directory: string): PresetMarker | undefined {
  try {
    const value = JSON.parse(readFileSync(join(directory, PRESET_MARKER), 'utf8')) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    return value as PresetMarker
  } catch {
    return undefined
  }
}

export function installLiangshenPreset(
  options: LiangshenInstallOptions = {},
): 'installed' | 'current' | 'conflict' {
  const source = options.sourceRoot ?? packagedPresetRoot()
  const sourceMarker = readMarker(source)
  if (
    !existsSync(join(source, 'agent.cordis.yml'))
    || !existsSync(join(source, 'preset.yml'))
    || sourceMarker?.owner !== PRESET_OWNER
    || sourceMarker.preset !== PRESET_ID
  ) {
    throw new Error(`packaged preset ${PRESET_ID} is incomplete`)
  }

  const target = join(options.dataRoot ?? dataRoot(), '.agent-presets', PRESET_ID)
  if (existsSync(target)) {
    const targetMarker = readMarker(target)
    if (targetMarker?.owner !== PRESET_OWNER || targetMarker.preset !== PRESET_ID) return 'conflict'
    if (targetMarker.revision === sourceMarker.revision) return 'current'
  }

  const targetRoot = dirname(target)
  mkdirSync(targetRoot, { recursive: true, mode: 0o700 })
  const staged = join(targetRoot, `.${PRESET_ID}.staged-${String(process.pid)}`)
  const backup = join(targetRoot, `.${PRESET_ID}.backup-${String(process.pid)}`)
  rmSync(staged, { recursive: true, force: true })
  rmSync(backup, { recursive: true, force: true })
  cpSync(source, staged, { recursive: true, force: false, errorOnExist: true })
  try {
    if (existsSync(target)) renameSync(target, backup)
    renameSync(staged, target)
    rmSync(backup, { recursive: true, force: true })
  } catch (error) {
    if (!existsSync(target) && existsSync(backup)) renameSync(backup, target)
    rmSync(staged, { recursive: true, force: true })
    throw error
  }
  return 'installed'
}

export function apply(ctx: HostContext, options: LiangshenInstallOptions = {}): void {
  // A read-only viewer shares the data root with an active surface; installing
  // here would replace preset state that surface owns.
  if (process.env.OH_DSH_READ_ONLY === '1') return
  try {
    const status = installLiangshenPreset(options)
    if (status === 'conflict') {
      ctx.logger.warn(
        `oh-dsh-liangshen: preset "${PRESET_ID}" was not installed because an unmanaged preset already uses that id`,
      )
    }
  } catch (error) {
    ctx.logger.warn(
      `oh-dsh-liangshen: unable to install preset (${error instanceof Error ? error.message : String(error)})`,
    )
  }
}
