import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply } from '../plugins/desktop-shell/src/index.ts'

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
