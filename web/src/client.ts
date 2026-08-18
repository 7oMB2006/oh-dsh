/** Browser face of the Oh-DSH Web shell. */

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

const WEB_CHROME_CSS = `
html[data-oh-dsh-web='true'] [class*='sessionLogButton'] {
  position: fixed;
  z-index: 2147483647;
  top: 7px;
  right: 126px;
}
`

function installWebChrome(): () => void {
  const style = document.createElement('style')
  style.dataset.ohDshWebChrome = 'true'
  style.textContent = WEB_CHROME_CSS
  document.head.append(style)
  document.documentElement.dataset.ohDshWeb = 'true'

  return () => {
    style.remove()
    delete document.documentElement.dataset.ohDshWeb
  }
}

/** Enroll the web shell identity and the client-plane surface contract. */
export function apply(ctx: ClientContext): void {
  // The unified three-surface contract, client plane: the web shell.
  ctx.reflect.provide(OH_DSH_SURFACE_VIEW_SERVICE, Object.freeze({
    kind: 'web',
  } satisfies OhDshSurfaceView), undefined)
  ctx.effect(() => {
    const removeChrome = installWebChrome()
    const originalTitle = document.title
    document.title = 'Oh-DSH Web'
    return () => {
      removeChrome()
      document.title = originalTitle
    }
  }, 'oh-dsh-web: shell identity')
  ctx.effect(() => {
    const headlineCopy = new Set([
      'Into the Unknown',
      '探索未知之境',
      '探索未至之境',
    ])
    const originalHeadlines = new Map<HTMLElement, string>()
    const synchronize = (): void => {
      for (const element of document.querySelectorAll<HTMLElement>('span')) {
        const text = element.textContent?.trim() ?? ''
        if (!headlineCopy.has(text)) continue
        if (!originalHeadlines.has(element)) originalHeadlines.set(element, text)
        element.textContent = 'Oh-DSH Web'
        element.dataset.ohDshWebHeroHeadline = 'true'
      }
    }
    const observer = new MutationObserver(synchronize)
    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    synchronize()
    return () => {
      observer.disconnect()
      for (const [element, original] of originalHeadlines) {
        if (element.isConnected && element.textContent === 'Oh-DSH Web') {
          element.textContent = original
        }
        delete element.dataset.ohDshWebHeroHeadline
      }
    }
  }, 'oh-dsh-web: hero identity')
}
