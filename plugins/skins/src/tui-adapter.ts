/** TUI adapter for the shared Oh-DSH skin catalog. */

import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  DEFAULT_SKIN_PREFERENCES,
  isSkinId,
  parseSkinPreferences,
  type FallbackTheme,
  type SkinPreferences,
} from './preferences.ts'
import { OH_DSH_SKINS } from './skins.ts'

const BUILTIN_TUI_THEMES = new Set(['light', 'dark', 'dark-ansi'])

export interface TuiSkinPaths {
  preferences: string
  themePreference: string
  themes: string
}

export interface TuiSkinActivation {
  activeId: string | null
  theme: string | undefined
}

/** Resolve the two stores joined by the TUI adapter. */
export function tuiSkinPaths(
  dataRoot: string,
  tuiConfigRoot: string = join(homedir(), '.ohdsh', 'tui'),
): TuiSkinPaths {
  return Object.freeze({
    preferences: join(dataRoot, 'skins.json'),
    themePreference: join(tuiConfigRoot, 'theme.json'),
    themes: join(tuiConfigRoot, 'themes'),
  })
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.next-${String(process.pid)}`
  writeFileSync(temporary, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 })
  try {
    renameSync(temporary, path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'EPERM') {
      rmSync(temporary, { force: true })
      throw error
    }
    copyFileSync(temporary, path)
    rmSync(temporary, { force: true })
  }
}

function readThemePreference(path: string): string | undefined {
  const value = readJson(path)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const theme = (value as Record<string, unknown>).theme
  if (typeof theme !== 'string' || theme.length === 0) return undefined
  if (theme === '.' || theme === '..' || theme.includes('/') || theme.includes('\\')) {
    return undefined
  }
  return theme
}

function readPreferences(path: string): SkinPreferences {
  return parseSkinPreferences(readJson(path)) ?? DEFAULT_SKIN_PREFERENCES
}

function fallbackFor(theme: string, current: FallbackTheme): FallbackTheme {
  if (theme === 'light') return 'light'
  if (theme === 'dark' || theme === 'dark-ansi') return 'dark'
  return current
}

function samePreferences(left: SkinPreferences, right: SkinPreferences): boolean {
  return left.activeId === right.activeId
    && left.fallbackTheme === right.fallbackTheme
}

function installThemeFiles(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  for (const skin of OH_DSH_SKINS) {
    writeJsonAtomic(join(directory, `${skin.id}.json`), {
      name: skin.id,
      displayName: `Oh-DSH · ${skin.displayName}`,
      base: skin.colorScheme,
      colors: skin.tui,
    })
  }
}

/**
 * Join the skin preference contract to dsh-TUI's native `/theme` contract.
 * The TUI picker remains authoritative when it has a persisted value; a
 * skin chosen there is mirrored to `skins.json` on the next launch. When
 * no TUI choice exists, the shared preference seeds the upstream picker.
 */
export function mountTuiSkins(
  dataRoot: string,
  tuiConfigRoot?: string,
): TuiSkinActivation {
  const paths = tuiSkinPaths(dataRoot, tuiConfigRoot)
  installThemeFiles(paths.themes)

  const preferences = readPreferences(paths.preferences)
  const theme = readThemePreference(paths.themePreference)
  if (theme !== undefined) {
    const next = isSkinId(theme)
      ? Object.freeze({ ...preferences, activeId: theme })
      : BUILTIN_TUI_THEMES.has(theme)
        ? Object.freeze({
            activeId: null,
            fallbackTheme: fallbackFor(theme, preferences.fallbackTheme),
          })
        : Object.freeze({ ...preferences, activeId: null })
    if (!samePreferences(preferences, next)) writeJsonAtomic(paths.preferences, next)
    return Object.freeze({ activeId: next.activeId, theme })
  }

  const seededTheme = preferences.activeId
    ?? (preferences.fallbackTheme === 'system' ? undefined : preferences.fallbackTheme)
  if (seededTheme !== undefined) {
    writeJsonAtomic(paths.themePreference, { theme: seededTheme })
  }
  return Object.freeze({ activeId: preferences.activeId, theme: seededTheme })
}
