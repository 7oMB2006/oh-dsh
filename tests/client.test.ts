import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply, desktopTitlebarHeight } from '../src/client.ts'

test('desktop titlebar offset follows native window chrome', () => {
  assert.equal(desktopTitlebarHeight('darwin'), 40)
  assert.equal(desktopTitlebarHeight('win32'), 0)
  assert.equal(desktopTitlebarHeight('linux'), 0)
})

function installFakeDesktopDom(platform: NodeJS.Platform = 'win32'): {
  getDesktopChromeEnabled: () => boolean
  getTitlebarHeight: () => string
  restore: () => void
} {
  const globalObject = globalThis as unknown as {
    document?: unknown
    MutationObserver?: unknown
    window?: unknown
  }
  const previous = {
    document: globalObject.document,
    mutationObserver: globalObject.MutationObserver,
    window: globalObject.window,
  }
  const values = new Map<string, string>()
  const documentElement = {
    dataset: {} as Record<string, string>,
    style: {
      getPropertyValue: (name: string): string => values.get(name) ?? '',
      removeProperty: (name: string): void => { values.delete(name) },
      setProperty: (name: string, value: string): void => { values.set(name, value) },
    },
  }
  const body = { dataset: {} as Record<string, string> }
  const style = {
    dataset: {} as Record<string, string>,
    remove: (): void => {},
    textContent: '',
  }
  globalObject.document = {
    body,
    createElement: (): typeof style => style,
    documentElement,
    head: { append: (): void => {} },
    querySelectorAll: (): [] => [],
    title: '',
  } as unknown as Document
  globalObject.MutationObserver = class {
    disconnect(): void {}
    observe(): void {}
  } as unknown as typeof MutationObserver
  const bridge = {
    platform,
    getInfo: async () => ({
      appDataPath: '',
      dshHome: '',
      platform: 'win32' as const,
      preview: null,
      profile: 'desktop',
      version: '0.0.0',
    }),
    onCommand: (): (() => void) => () => {},
  }
  globalObject.window = { dshDesktop: bridge } as unknown as Window
  return {
    getDesktopChromeEnabled: () => documentElement.dataset.ohDshDesktop === 'true',
    getTitlebarHeight: () => values.get('--oh-dsh-titlebar-height') ?? '',
    restore: () => {
      if (previous.document === undefined) delete globalObject.document
      else globalObject.document = previous.document
      if (previous.mutationObserver === undefined) delete globalObject.MutationObserver
      else globalObject.MutationObserver = previous.mutationObserver
      if (previous.window === undefined) delete globalObject.window
      else globalObject.window = previous.window
    },
  }
}

function applyWithInfo(getInfo: () => Promise<unknown>, platform: NodeJS.Platform = 'win32'): { dom: ReturnType<typeof installFakeDesktopDom>; dispose: () => void } {
  const dom = installFakeDesktopDom(platform)
  const bridge = (globalThis as unknown as { window: { dshDesktop: { getInfo: () => Promise<unknown> } } }).window.dshDesktop
  bridge.getInfo = getInfo
  const disposers: Array<() => void> = []
  const locale = {
    bind: () => () => '',
    register: () => undefined,
    subscribe: () => () => {},
  }
  apply({
    effect: effect => {
      const dispose = effect()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    get: name => name === 'locale' ? locale : {},
    reflect: { provide: () => {} },
  })
  return {
    dom,
    dispose: () => {
      for (const dispose of disposers.reverse()) dispose()
      dom.restore()
    },
  }
}

test('installs the platform chrome before the asynchronous info lookup', async () => {
  let resolveInfo: (value: unknown) => void = () => {}
  const info = new Promise<unknown>(resolve => { resolveInfo = resolve })
  const { dom, dispose } = applyWithInfo(() => info, 'darwin')
  try {
    assert.equal(dom.getTitlebarHeight(), '40px')
    assert.equal(dom.getDesktopChromeEnabled(), true)
    resolveInfo({
      appDataPath: '',
      dshHome: '',
      platform: 'darwin',
      preview: null,
      profile: 'desktop',
      version: '0.0.0',
    })
    await info
    await Promise.resolve()
    assert.equal(dom.getTitlebarHeight(), '40px')
  } finally {
    dispose()
  }
})

test('keeps macOS chrome when platform info lookup fails', async () => {
  const originalError = console.error
  console.error = () => {}
  const { dom, dispose } = applyWithInfo(async () => { throw new Error('lookup failed') }, 'darwin')
  try {
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(dom.getTitlebarHeight(), '40px')
    assert.equal(dom.getDesktopChromeEnabled(), true)
  } finally {
    console.error = originalError
    dispose()
  }
})
