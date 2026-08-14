/** Host half of Oh-DSH skins: durable preferences on the surface origin. */

import {
  mountDesktopSkinPreferences,
  type DesktopCapability,
  type DesktopSkinPreferencesHostContext,
} from './preferences-server.ts'
import { mountTuiSkins } from './tui-adapter.ts'
import {
  hasBrowserSurface,
  OH_DSH_SURFACE_SERVICE,
  type OhDshSurface,
} from '../../shared/surface.ts'

interface HostContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  inject(names: string[], callback: (ctx: HostContext) => void): void
  logger: DesktopSkinPreferencesHostContext['logger']
}

export const name = 'oh-dsh-skins'
export const inject: string[] = []

function mountSurface(ctx: HostContext): void {
  const surface = ctx.get(OH_DSH_SURFACE_SERVICE) as OhDshSurface | undefined
  const legacy = ctx.get('desktop') as DesktopCapability | undefined
  const dataRoot = surface?.dataRoot ?? legacy?.appDataPath ?? ''
  if (dataRoot === '') {
    ctx.logger.warn('oh-dsh-skins: no writable data root; skin preferences disabled')
    return
  }

  if (surface?.kind === 'tui') {
    const tuiConfigRoot = process.env.OH_DSH_TUI_CONFIG_HOME
    ctx.effect(() => {
      mountTuiSkins(dataRoot, tuiConfigRoot)
    }, 'oh-dsh-skins: TUI palette adapter')
    return
  }

  if (!hasBrowserSurface(surface?.kind) && legacy === undefined) {
    ctx.logger.warn('oh-dsh-skins: unsupported surface; skin preferences disabled')
    return
  }
  ctx.inject(['webServer'], browserCtx => {
    const webServer = browserCtx.get('webServer') as
      DesktopSkinPreferencesHostContext['webServer'] | undefined
    if (webServer === undefined) {
      browserCtx.logger.warn('oh-dsh-skins: browser preferences server is unavailable')
      return
    }
    browserCtx.effect(
      () => mountDesktopSkinPreferences({ logger: browserCtx.logger, webServer }, {
        appDataPath: dataRoot,
      }),
      'oh-dsh-skins: skin preferences',
    )
  })
}

export function apply(ctx: HostContext): void {
  // Static injection would make the TUI wait forever for webServer. Listen
  // for the common surface first, then require browser services only for a
  // browser-capable surface.
  ctx.inject([OH_DSH_SURFACE_SERVICE], mountSurface)
}
