/**
 * Cordis entry for the Oh-DSH TUI renderer adapter. Config shape mirrors the
 * pinned dsh-TUI plugin; `apply` lives in plugin.ts and wraps the upstream
 * renderer with the shared plugin marketplace surface.
 */

import { apply as applyMarketplaceTui } from './plugin.ts'
import { Config as TuiRendererConfig } from '../../../upstream/dsh-TUI/src/index.ts'

export const name = 'oh-tui-marketplace'
export const inject = ['agents', 'agentLoop']
export const Config = TuiRendererConfig

export function apply(ctx: Parameters<typeof applyMarketplaceTui>[0], config: Parameters<typeof applyMarketplaceTui>[1]): Promise<void> {
  return applyMarketplaceTui(ctx, config)
}
