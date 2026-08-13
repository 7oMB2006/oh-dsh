/** Host half of Oh-DSH skins: durable preferences on the surface origin. */

import {
  mountDesktopSkinPreferences,
  type DesktopCapability,
  type DesktopSkinPreferencesHostContext,
} from './preferences-server.ts'
import {
  hasBrowserSurface,
  OH_DSH_SURFACE_SERVICE,
  type OhDshSurface,
} from '../../shared/surface.ts'

interface HostContext extends DesktopSkinPreferencesHostContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
}

export const name = 'oh-dsh-skins'
export const inject = ['webServer']

export function apply(ctx: HostContext): void {
  // Three-surface adaptation: the preferences server needs a writable data
  // root, which every browser-capable shell provides through the shared
  // `ohDshSurface` service. Desktop and web mount it; the TUI shell has no
  // webServer and no browser, so this row never activates there.
  const surface = ctx.get(OH_DSH_SURFACE_SERVICE) as OhDshSurface | undefined
  const legacy = ctx.get('desktop') as DesktopCapability | undefined
  const dataRoot = surface?.dataRoot ?? legacy?.appDataPath ?? ''
  if (!hasBrowserSurface(surface?.kind) && legacy === undefined) {
    ctx.logger.warn('oh-dsh-skins: no browser surface; skin preferences disabled')
    return
  }
  if (dataRoot === '') {
    ctx.logger.warn('oh-dsh-skins: no writable data root; skin preferences disabled')
    return
  }
  ctx.effect(
    () => mountDesktopSkinPreferences(ctx, { appDataPath: dataRoot }),
    'oh-dsh-skins: skin preferences',
  )
}
