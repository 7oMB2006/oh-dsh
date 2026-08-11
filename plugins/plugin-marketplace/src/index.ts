interface HostContext {
  provide(name: string, value: unknown): void
}

export const name = 'oh-dsh-plugin-marketplace'

/** Facts other Host plugins can inspect without receiving Electron access. */
export interface PluginMarketplaceHost {
  catalog: 'dsh-external/hub'
  preview: 'isolated-profile'
}

export function apply(ctx: HostContext): void {
  ctx.provide('pluginMarketplaceHost', Object.freeze({
    catalog: 'dsh-external/hub',
    preview: 'isolated-profile',
  } satisfies PluginMarketplaceHost))
}
