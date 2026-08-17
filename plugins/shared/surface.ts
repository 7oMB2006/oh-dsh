/**
 * Oh-DSH surface contract: every packaged shell identifies the interaction
 * form it provides through one `ohDshSurface` service. Built-in plugins read
 * this service and adapt explicitly per surface instead of guessing from
 * environment variables or window presence.
 *
 * - `desktop` — the Electron shell (`@oh-dsh/desktop`): native windows and
 *   menus, the Electron bridge, and the full local capability set.
 * - `web` — the browser shell (`@oh-dsh/web`): the DSH web UI served over
 *   HTTP. The browser client graph matches desktop wherever the host
 *   services exist (skins, pinned summary, sidebar, terminal dock, and the
 *   plugin marketplace); only Electron-bound native chrome differs.
 * - `tui` — the terminal shell (`@oh-dsh/tui`): no browser client graph.
 *   Its plugin marketplace is mounted through the shared DSH command
 *   registry and the downstream TUI renderer adapter.
 */

/** The three interaction forms a shell can provide. */
export type OhDshSurfaceKind = 'desktop' | 'web' | 'tui'

/** Host-plane surface facts provided by the active shell bundle. */
export interface OhDshSurface {
  dataRoot: string
  kind: OhDshSurfaceKind
  platform: NodeJS.Platform
  profile: string
  version: string
}

/** Service name shells provide the surface under (host plane). */
export const OH_DSH_SURFACE_SERVICE = 'ohDshSurface' as const

/** Browser-plane surface facts reflected by the active shell client. */
export interface OhDshSurfaceView {
  kind: OhDshSurfaceKind
}

/** Service name shell clients reflect the surface under (client plane). */
export const OH_DSH_SURFACE_VIEW_SERVICE = 'ohDshSurface' as const

/** Whether a browser-visible surface exists for a host plugin to mount on. */
export function hasBrowserSurface(kind: OhDshSurfaceKind | undefined): boolean {
  return kind === 'desktop' || kind === 'web'
}
