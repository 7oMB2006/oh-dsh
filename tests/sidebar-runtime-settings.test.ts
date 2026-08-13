import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_SIDEBAR_RUNTIME_PREFERENCES,
  parseSidebarRuntimePreferences,
  SidebarRuntimeSettingsService,
} from '../plugins/sidebar/src/client/runtime-settings.ts'

test('sidebar runtime settings default missing upstream fields safely', () => {
  assert.deepEqual(parseSidebarRuntimePreferences({
    agentTerminalTools: true,
    interceptOpenPath: false,
  }), {
    ...DEFAULT_SIDEBAR_RUNTIME_PREFERENCES,
    agentTerminalTools: true,
    interceptOpenPath: false,
  })
})

test('sidebar runtime settings serialize revision-guarded updates', async () => {
  const writes: Array<{
    patch: Record<string, unknown>
    revision: number | undefined
  }> = []
  let value = { ...DEFAULT_SIDEBAR_RUNTIME_PREFERENCES }
  let revision = 4
  const service = new SidebarRuntimeSettingsService({
    settingsGet: async () => ({ revision, value }),
    settingsUpdate: async (patch, expectedRevision) => {
      writes.push({ patch, revision: expectedRevision })
      value = { ...value, ...patch }
      revision += 1
      return { revision, value }
    },
  })

  await service.start()
  await Promise.all([
    service.update({ agentTerminalTools: true }),
    service.update({ browserInterceptLinks: false }),
  ])

  assert.deepEqual(writes, [
    { patch: { agentTerminalTools: true }, revision: 4 },
    { patch: { browserInterceptLinks: false }, revision: 5 },
  ])
  assert.equal(service.getSnapshot().preferences.agentTerminalTools, true)
  assert.equal(service.getSnapshot().preferences.browserInterceptLinks, false)
  assert.equal(service.getSnapshot().revision, 6)
})
