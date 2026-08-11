import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { apply } from '../plugins/desktop-shell/src/index.ts'

test('desktop client replaces the hero title and keeps the Preview badge', () => {
  const client = readFileSync(new URL('../plugins/desktop-shell/src/client.ts', import.meta.url), 'utf8')
  assert.match(client, /element\.textContent = 'Oh-DSH-Desktop'/)
  assert.match(client, /\['Into the Unknown', '探索未知之境'\]/)
  assert.doesNotMatch(client, /data-oh-dsh-hero-preview/)
})

test('every bundled Oh-DSH client follows the native locale service', () => {
  const clients = [
    '../plugins/desktop-shell/src/client.ts',
    '../plugins/panel-controls/src/terminal/plugin.tsx',
    '../plugins/pinned-summary/src/client.ts',
    '../plugins/plugin-marketplace/src/client/plugin.tsx',
    '../plugins/workspace-tools/src/client/plugin.tsx',
  ]
  for (const path of clients) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /export const inject = \[[^\]]*'locale'/)
    assert.match(source, /locale\.register\('oh-dsh\./)
  }

  const dictionaries = [
    '../plugins/panel-controls/src/terminal/i18n.ts',
    '../plugins/pinned-summary/src/i18n.ts',
    '../plugins/plugin-marketplace/src/client/i18n.ts',
    '../plugins/workspace-tools/src/client/i18n.ts',
  ]
  for (const path of dictionaries) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /en: \{/)
    assert.match(source, /zh: \{/)
  }
})

test('desktop-shell Host plugin publishes capability, prompt, and bash environment', () => {
  const previous = {
    appData: process.env.DSH_DESKTOP_APP_DATA,
    profile: process.env.DSH_DESKTOP_PROFILE,
    version: process.env.DSH_DESKTOP_VERSION,
  }
  process.env.DSH_DESKTOP_APP_DATA = '/tmp/dsh-desktop-data'
  process.env.DSH_DESKTOP_PROFILE = 'desktop'
  process.env.DSH_DESKTOP_VERSION = '9.8.7'
  let capability: unknown
  let prompt = ''
  let resolvedEnvironment: Record<string, string> = {}
  let terminalPath = ''
  const context = {
    effect: <T>(effect: () => T): T => effect(),
    get: () => undefined,
    httpServer: {
      port: 4321,
      registerUpgrade: (route: { path: string }): (() => void) => {
        terminalPath = route.path
        return () => {}
      },
    },
    logger: {
      debug: () => {},
      warn: () => {},
    },
    inject: (names: string[], callback: (ctx: unknown) => void): void => {
      if (names[0] === 'systemPrompt') {
        callback({
          systemPrompt: {
            section: (section: { text: () => string }) => { prompt = section.text() },
          },
        })
      }
      if (names[0] === 'bashEnv') {
        callback({
          bashEnv: {
            register: (entry: { resolve: () => Record<string, string> }) => {
              resolvedEnvironment = entry.resolve()
            },
          },
        })
      }
    },
    provide: (name: string, value: unknown): void => {
      if (name === 'desktop') capability = value
    },
  }
  try {
    apply(context as Parameters<typeof apply>[0])
    assert.deepEqual(capability, {
      appDataPath: '/tmp/dsh-desktop-data',
      kind: 'electron',
      platform: process.platform,
      profile: 'desktop',
      version: '9.8.7',
    })
    assert.match(prompt, /Oh-DSH-Desktop/)
    assert.doesNotMatch(prompt, /ChatGPT|OpenAI/)
    assert.equal(terminalPath, '/oh-dsh-desktop/terminal/ws')
    assert.deepEqual(resolvedEnvironment, {
      DSH_DESKTOP: '1',
      DSH_DESKTOP_APP_DATA: '/tmp/dsh-desktop-data',
      DSH_DESKTOP_PROFILE: 'desktop',
      DSH_DESKTOP_VERSION: '9.8.7',
    })
  } finally {
    if (previous.appData === undefined) delete process.env.DSH_DESKTOP_APP_DATA
    else process.env.DSH_DESKTOP_APP_DATA = previous.appData
    if (previous.profile === undefined) delete process.env.DSH_DESKTOP_PROFILE
    else process.env.DSH_DESKTOP_PROFILE = previous.profile
    if (previous.version === undefined) delete process.env.DSH_DESKTOP_VERSION
    else process.env.DSH_DESKTOP_VERSION = previous.version
  }
})
