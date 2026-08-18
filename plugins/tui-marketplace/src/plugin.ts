import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  TuiSceneProps,
  TuiSceneRuntime,
} from '../../../upstream/dsh-TUI/src/scenes.ts'
import type { TuiShortcutRuntime } from '../../../upstream/dsh-TUI/src/extensions.ts'
import type { PluginMarketplaceBridge } from '../../plugin-marketplace/src/protocol.ts'
import { TuiMarketplaceController } from './marketplace-controller.ts'
import { TuiMarketplaceScene } from './marketplace.tsx'

const MARKETPLACE_SCENE = 'oh-dsh-marketplace'

export const name = 'oh-tui-marketplace'
export const inject = ['pluginMarketplace', 'tuiScenes', 'tuiShortcuts']

function writeRestartMarker(sessionId: string): void {
  const dataRoot = process.env.OH_DSH_HOME ?? process.env.DSH_HOME
  if (dataRoot === undefined || dataRoot === '') return
  const directory = join(dataRoot, 'tui')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  writeFileSync(join(directory, 'marketplace-resume'), sessionId, { mode: 0o600 })
}

/** Register the Oh-DSH marketplace into the upstream TUI extension seams. */
export async function apply(ctx: Context): Promise<void> {
  const bridge = ctx.get('pluginMarketplace') as PluginMarketplaceBridge | undefined
  const scenes = ctx.get('tuiScenes') as TuiSceneRuntime | undefined
  const shortcuts = ctx.get('tuiShortcuts') as TuiShortcutRuntime | undefined
  if (bridge === undefined || scenes === undefined || shortcuts === undefined) {
    throw new Error('Oh-DSH TUI marketplace services did not activate')
  }

  if (process.env.OH_DSH_TUI_MARKETPLACE_PREVIEW_PROBE === '1') {
    await new Promise<void>(resolve => { setImmediate(resolve) })
    process.exit(0)
  }

  let activeSessionId: string | undefined
  const controller = new TuiMarketplaceController(bridge, () => {
    if (activeSessionId !== undefined) writeRestartMarker(activeSessionId)
  })
  const Scene = (props: TuiSceneProps): ReturnType<typeof TuiMarketplaceScene> => {
    activeSessionId = props.channel.agentId
    return props.React.createElement(TuiMarketplaceScene, {
      ...props,
      controller,
    }) as ReturnType<typeof TuiMarketplaceScene>
  }
  const open = (): void => {
    if (scenes.open(MARKETPLACE_SCENE)) void controller.load()
  }

  ctx.effect(
    () => scenes.register({
      component: Scene,
      id: MARKETPLACE_SCENE,
      title: 'Plugin marketplace',
    }, ctx),
    'oh-dsh-tui-marketplace: scene',
  )
  ctx.effect(
    () => shortcuts.register('ctrl+m', {
      description: 'Open the Oh-DSH plugin marketplace',
      handler: open,
    }, ctx),
    'oh-dsh-tui-marketplace: shortcut',
  )
  const disposeCommandOpener = ctx.on('session/event', (_session, event) => {
    if ((event as { type?: string }).type !== 'command/run') return
    const command = (event as { data?: { name?: string } }).data?.name
    if (command === 'plugins') open()
  })
  ctx.effect(
    () => disposeCommandOpener,
    'oh-dsh-tui-marketplace: command opener',
  )
}
