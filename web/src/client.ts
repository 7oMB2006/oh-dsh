/** Browser face of the Oh-DSH-Web shell. */

import {
  OH_DSH_SURFACE_VIEW_SERVICE,
  type OhDshSurfaceView,
} from '../../plugins/shared/surface.ts'

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  reflect: {
    provide(name: string, value: unknown, options?: unknown): (() => Promise<void> | void) | void
  }
}

/** Enroll the web shell identity and the client-plane surface contract. */
export function apply(ctx: ClientContext): void {
  // The unified three-surface contract, client plane: the web shell.
  ctx.reflect.provide(OH_DSH_SURFACE_VIEW_SERVICE, Object.freeze({
    kind: 'web',
  } satisfies OhDshSurfaceView), undefined)
  ctx.effect(() => {
    const originalTitle = document.title
    document.title = 'Oh-DSH-Web'
    return () => { document.title = originalTitle }
  }, 'oh-dsh-web: shell identity')
}
