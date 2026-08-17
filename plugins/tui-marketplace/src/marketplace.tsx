import React, { useSyncExternalStore } from 'react'
import type { Key } from '../../../upstream/dsh-TUI/src/ink/events/input-event.ts'
import type { InputEvent } from '../../../upstream/dsh-TUI/src/ink/events/input-event.ts'
import { Box, Text, useInput, useTerminalSize } from '../../../upstream/dsh-TUI/src/ui.ts'
import { Chat } from '../../../upstream/dsh-TUI/src/screens/Chat.tsx'
import type { Channel } from '../../../upstream/dsh-TUI/src/channel.ts'
import type { QuestionStore } from '../../../upstream/dsh-TUI/src/questions.ts'
import type {
  MarketplaceConfirmation,
  MarketplacePlugin,
} from '../../plugin-marketplace/src/protocol.ts'
import {
  type MarketplaceOpenStore,
  type TuiMarketplaceController,
  surfaceMarker,
} from './marketplace-controller.ts'

const POINTER = '❯'

function clip(text: string, columns: number): string {
  if (text.length <= columns) return text
  return `${text.slice(0, Math.max(0, columns - 1))}…`
}

function confirmationLabel(confirmation: MarketplaceConfirmation): string {
  if (confirmation === 'allow-build-scripts') return 'Allow install scripts in the isolated preview'
  if (confirmation === 'accept-high-risk') return 'Accept trusted host code after apply'
  return 'Accept the changed source identity'
}

function pluginBadges(plugin: MarketplacePlugin): string {
  const badges: string[] = []
  if (plugin.installed) badges.push(plugin.enabled ? 'enabled' : 'disabled')
  if (plugin.updateAvailable) badges.push('update')
  if (plugin.protected) badges.push('managed')
  if (badges.length === 0) return ''
  return ` · ${badges.join(' · ')}`
}

function MarketplaceInputGate({
  controller,
  openStore,
}: {
  controller: TuiMarketplaceController
  openStore: MarketplaceOpenStore
}): null {
  const open = useSyncExternalStore(openStore.subscribe, openStore.getSnapshot)
  useInput((input, key, event) => {
    if (open === false) {
      if (key.ctrl && input === 'm') {
        openStore.open()
        void controller.load()
        event.stopImmediatePropagation()
      }
      return
    }
    event.stopImmediatePropagation()
    handleOpenKey(controller, openStore, input, key)
  })
  return null
}

function handleOpenKey(
  controller: TuiMarketplaceController,
  openStore: MarketplaceOpenStore,
  input: string,
  key: Key,
): void {
  const state = controller.getSnapshot()
  if (state.confirmation !== null) {
    if (input === 'y') controller.acceptConfirmation()
    if (input === 'n' || key.escape) controller.cancelConfirmation()
    return
  }
  if (key.escape || (key.ctrl && input === 'c')) {
    if (state.screen === 'detail') controller.openDetail(null)
    else openStore.close()
    return
  }
  if (key.ctrl && input === 'm') {
    openStore.close()
    return
  }
  if (key.return) {
    if (state.screen === 'list') {
      const plugins = controller.filteredPlugins()
      const selected = plugins.find(plugin => plugin.id === state.selectedId)
      if (selected !== undefined) controller.openDetail(selected.id)
    }
    return
  }
  if (key.backspace) {
    if (state.screen === 'list') {
      controller.setQuery(state.query.slice(0, -1))
    } else {
      controller.openDetail(null)
    }
    return
  }
  if (key.upArrow || key.downArrow) {
    if (state.screen === 'list') {
      controller.moveSelection(key.upArrow ? -1 : 1)
    }
    return
  }
  if (input === 'r' && state.screen === 'list') {
    void controller.refresh()
    return
  }
  if (input === 'b' && state.screen === 'detail') {
    controller.openDetail(null)
    return
  }
  if (input === 'i' && state.screen === 'detail') {
    const plugin = controller.selectedPlugin()
    if (plugin !== null && plugin.installed === false) {
      void controller.prepare('install', plugin.id)
    }
    return
  }
  if (input === 'u' && state.screen === 'detail') {
    const plugin = controller.selectedPlugin()
    if (plugin !== null && plugin.installed && plugin.updateAvailable) {
      void controller.prepare('update', plugin.id)
    }
    return
  }
  if (input === 'e' && state.screen === 'detail') {
    const plugin = controller.selectedPlugin()
    if (plugin !== null && plugin.installed && plugin.enabled === false) {
      void controller.prepare('enable', plugin.id)
    }
    return
  }
  if (input === 'd' && state.screen === 'detail') {
    const plugin = controller.selectedPlugin()
    if (plugin !== null && plugin.installed && plugin.enabled) {
      void controller.prepare('disable', plugin.id)
    }
    return
  }
  if (input === 'x' && state.screen === 'detail') {
    const plugin = controller.selectedPlugin()
    if (plugin !== null && plugin.installed) {
      void controller.prepare('uninstall', plugin.id)
    }
    return
  }
  if (input === 'p' && state.screen === 'detail'
    && state.snapshot?.plan !== null && state.snapshot?.plan !== undefined) {
    void controller.preview()
    return
  }
  if (input === 'a' && state.snapshot?.preview !== null
    && state.snapshot?.preview !== undefined) {
    void controller.dispatch({ type: 'apply' })
    return
  }
  if (input === 'n' && state.snapshot?.preview !== null
    && state.snapshot?.preview !== undefined) {
    void controller.dispatch({ type: 'discard' })
    return
  }
  if (input === 'w' && state.snapshot?.undoAvailable === true) {
    void controller.dispatch({ type: 'undo' })
    return
  }
  if (state.screen === 'list' && input.length > 0 && key.ctrl === false && key.meta === false) {
    controller.setQuery(state.query + input)
  }
}

function MarketplaceList({
  columns,
  rows,
  controller,
}: {
  columns: number
  rows: number
  controller: TuiMarketplaceController
}): React.ReactNode {
  const state = controller.getSnapshot()
  const plugins = controller.filteredPlugins()
  const visibleRows = Math.max(1, rows - 7)
  const selectedIndex = Math.max(
    0,
    plugins.findIndex(plugin => plugin.id === state.selectedId),
  )
  const start = Math.min(
    Math.max(0, selectedIndex - Math.floor(visibleRows / 2)),
    Math.max(0, plugins.length - visibleRows),
  )
  const visible = plugins.slice(start, start + visibleRows)
  return (
    <Box flexDirection="column">
      <Box>
        <Text inverse>{clip(` /plugins  ${state.query}`, Math.max(24, columns - 40))}</Text>
        <Text> </Text>
        <Text color="subtle">{clip(`${plugins.length} plugins`, 14)}</Text>
      </Box>
      {state.error !== null && (
        <Box marginTop={1}><Text color="error">{clip(state.error, columns)}</Text></Box>
      )}
      <Box marginTop={1}>
        {visible.map((plugin, index) => {
          const selected = plugin.id === state.selectedId
          return (
            <Box key={plugin.id}>
              <Text color={selected ? 'remember' : undefined}>
                {selected ? POINTER : ' '} {clip(plugin.title, Math.max(16, columns - 48))}
                <Text color="subtle">{clip(pluginBadges(plugin), 26)}</Text>
              </Text>
              <Text color="subtle">{clip(`   ${plugin.category} · ${surfaceMarker(plugin)}`, Math.max(16, columns - 4))}</Text>
            </Box>
          )
        })}
        {plugins.length === 0 && <Text color="subtle">No plugins match this search.</Text>}
        {plugins.length > visible.length && (
          <Text color="subtle">{clip(`showing ${start + 1}-${Math.min(start + visible.length, plugins.length)} of ${plugins.length}`, columns)}</Text>
        )}
      </Box>
    </Box>
  )
}

function MarketplaceDetail({
  columns,
  controller,
}: {
  columns: number
  controller: TuiMarketplaceController
}): React.ReactNode {
  const state = controller.getSnapshot()
  const plugin = controller.selectedPlugin()
  if (plugin === null) return <Text>Select a plugin first.</Text>
  const plan = state.snapshot?.plan?.pluginId === plugin.id ? state.snapshot.plan : null
  const preview = state.snapshot?.preview
  const actions: string[] = []
  if (plugin.mechanism !== 'unsupported' && plugin.protected === false) {
    if (plugin.installed === false) actions.push('i=install')
    if (plugin.installed && plugin.updateAvailable) actions.push('u=update')
    if (plugin.installed && plugin.enabled === false) actions.push('e=enable')
    if (plugin.installed && plugin.enabled) actions.push('d=disable')
    if (plugin.installed) actions.push('x=uninstall')
  }
  if (plan !== null) actions.push('p=preview')
  if (preview !== null && preview !== undefined) {
    actions.push('a=apply', 'n=discard')
  }
  if (state.snapshot?.undoAvailable === true) actions.push('w=undo')
  actions.push('b=back')
  return (
    <Box flexDirection="column">
      <Text bold inverse>{clip(` ${plugin.title} `, columns)}</Text>
      <Text color="subtle">{clip(`${plugin.category} · ${plugin.installed ? (plugin.enabled ? 'enabled' : 'disabled') : 'not installed'}`, columns)}</Text>
      <Box marginTop={1}><Text>{clip(plugin.description, columns)}</Text></Box>
      <Text color="subtle">{clip(`surfaces: ${surfaceMarker(plugin)}`, columns)}</Text>
      <Text color="subtle">{clip(`repository: ${plugin.url.replace('https://github.com/', '')}`, columns)}</Text>
      {plan !== null && (
        <Box marginTop={1}>
          <Text color="warning">
            {clip(`plan: ${plan.action} risk=${plan.riskLevel} source=${plan.sourceReview}`, columns)}
          </Text>
        </Box>
      )}
      {preview !== null && preview !== undefined && (
        <Text color="success">{clip(`preview: ${preview.pluginId} · apply or discard`, columns)}</Text>
      )}
      {state.confirmation !== null && (
        <Box marginTop={1}>
          <Text color="warning">
            {clip(`Confirmation ${state.acceptedConfirmations.length + 1}/${state.snapshot?.plan?.requirements.length ?? 0}: ${confirmationLabel(state.confirmation)}`, columns)}
          </Text>
          <Text color="subtle">{clip('y accept · n cancel', columns)}</Text>
        </Box>
      )}
      {state.error !== null && <Text color="error">{clip(state.error, columns)}</Text>}
      {state.notice !== null && <Text color="subtle">{clip(state.notice, columns)}</Text>}
      <Box marginTop={1}><Text color="subtle">{clip(actions.join(' · '), columns)}</Text></Box>
    </Box>
  )
}

function MarketplaceOverlay({
  controller,
  open,
}: {
  controller: TuiMarketplaceController
  open: boolean
}): React.ReactNode {
  const { columns, rows } = useTerminalSize()
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  if (open === false) return null
  return (
    <Box
      position="absolute"
      top={0}
      bottom={0}
      left={0}
      right={0}
      backgroundColor="#14181f"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
    >
      <Box>
        <Text bold>Plugin marketplace</Text>
        <Text color="subtle"> search · install · preview · apply · esc close</Text>
      </Box>
      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        {state.screen === 'list'
          ? <MarketplaceList columns={columns} rows={rows} controller={controller} />
          : <MarketplaceDetail columns={columns} controller={controller} />}
        {state.busy && <Text color="subtle">Working…</Text>}
      </Box>
      <Text color="subtle">TUI installs always succeed, but plugins declare where they take effect — check the surfaces line.</Text>
    </Box>
  )
}

export function TuiMarketplaceShell({
  channel,
  controller,
  onExit,
  openStore,
  questionStore,
}: {
  channel: Channel
  controller: TuiMarketplaceController
  onExit: () => void
  openStore: MarketplaceOpenStore
  questionStore: QuestionStore
}): React.ReactNode {
  const open = useSyncExternalStore(openStore.subscribe, openStore.getSnapshot)
  return (
    <Box flexDirection="column" flexGrow={1} width="100%">
      <MarketplaceInputGate controller={controller} openStore={openStore} />
      <Chat channel={channel} questionStore={questionStore} onExit={onExit} />
      <MarketplaceOverlay controller={controller} open={open} />
    </Box>
  )
}
