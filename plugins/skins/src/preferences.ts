export const SKIN_IDS = [
  'oh-dsh-skin-deep-current',
  'oh-dsh-skin-jade-circuit',
  'oh-dsh-skin-porcelain',
  'oh-dsh-skin-ember-dusk',
] as const

export type SkinId = typeof SKIN_IDS[number]
export type FallbackTheme = 'light' | 'dark' | 'system'

export interface SkinPreferences {
  activeId: SkinId | null
  fallbackTheme: FallbackTheme
}

/** Browser compatibility aliases retained for the existing public API. */
export const DESKTOP_SKIN_IDS = SKIN_IDS
export type DesktopSkinId = SkinId
export type DesktopFallbackTheme = FallbackTheme
export type DesktopSkinPreferences = SkinPreferences

export const ACTIVE_SKIN_KEY = 'oh-dsh.skins.active'
export const FALLBACK_THEME_KEY = 'oh-dsh.skins.fallback'
export const PREFERENCES_API_PATH = '/oh-dsh/skins/preferences'
export const DEFAULT_SKIN_PREFERENCES: SkinPreferences = Object.freeze({
  activeId: null,
  fallbackTheme: 'system',
})

export function isSkinId(value: unknown): value is SkinId {
  return typeof value === 'string'
    && (SKIN_IDS as readonly string[]).includes(value)
}

export const isDesktopSkinId = isSkinId

export function isFallbackTheme(value: unknown): value is FallbackTheme {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function parseSkinPreferences(value: unknown): SkinPreferences | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const input = value as Record<string, unknown>
  if (input.activeId !== null && !isSkinId(input.activeId)) return undefined
  if (!isFallbackTheme(input.fallbackTheme)) return undefined
  return Object.freeze({
    activeId: input.activeId,
    fallbackTheme: input.fallbackTheme,
  }) as SkinPreferences
}
