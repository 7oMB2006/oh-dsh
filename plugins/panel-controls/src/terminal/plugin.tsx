import { Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import xtermCss from '@xterm/xterm/css/xterm.css'
import terminalCss from './terminal.css'
import { TerminalPanel, openOrToggleTerminal } from './TerminalPanel.tsx'
import { TerminalTrigger } from './TerminalTrigger.tsx'
import { createMountScheduler, mutationNeedsMount } from './mount-utils.ts'
import { createDockStore, type DockStore } from './panel-store.ts'

interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

interface SessionSummary {
  cwd?: string
}

interface SessionListState {
  current?: string
  byId: Record<string, SessionSummary>
}

interface SessionsService {
  list: ObservableSnapshot<SessionListState>
}

interface LayoutService {
  toggleSidebar(): void
}

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  reflect: {
    provide(name: string, value: unknown, options?: unknown): (() => Promise<void> | void) | void
  }
}

interface SessionSurface {
  scopeKey: string
  cwd: string | null
  store: DockStore
}

interface ReactMount {
  element: HTMLDivElement | null
  root: Root | null
}

export interface DesktopPanels {
  isBottomPanelOpen(): boolean
  subscribe(listener: () => void): () => void
  toggleBottomPanel(): void
  toggleSidebar(): void
}

export const inject = ['layout', 'sessions']

function currentSession(sessions: SessionsService): { scopeKey: string; cwd: string | null } {
  const snapshot = sessions.list.getSnapshot()
  const sessionId = snapshot.current
  return {
    scopeKey: sessionId ?? 'new-session',
    cwd: sessionId === undefined ? null : snapshot.byId[sessionId]?.cwd ?? null,
  }
}

function findConversationColumn(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-phase]')?.parentElement ?? null
}

function findTriggerSeat(column: HTMLElement): HTMLElement | null {
  const titleRow = column.querySelector<HTMLElement>('header > div')
  return titleRow ?? column.querySelector<HTMLElement>('header [role="tablist"]')
}

class DesktopPanelService implements DesktopPanels {
  private readonly listeners = new Set<() => void>()
  private readonly layout: LayoutService
  private readonly sessions: SessionsService
  private readonly surfaces = new Map<string, SessionSurface>()
  private active: SessionSurface | undefined
  private readonly dock: ReactMount = { element: null, root: null }
  private readonly trigger: ReactMount = { element: null, root: null }
  private style: HTMLStyleElement | undefined
  private observer: MutationObserver | undefined
  private stopSessionSubscription: (() => void) | undefined
  private stopActiveStoreSubscription: (() => void) | undefined
  private scheduler: ReturnType<typeof createMountScheduler> | undefined

  constructor(
    layout: LayoutService,
    sessions: SessionsService,
  ) {
    this.layout = layout
    this.sessions = sessions
  }

  mount(): void {
    this.style = document.createElement('style')
    this.style.dataset.ohDshTerminalStyles = 'true'
    this.style.textContent = `${xtermCss}\n${terminalCss}`
    document.head.append(this.style)
    this.scheduler = createMountScheduler(() => { this.mountAll() })
    this.syncActiveSession()
    this.stopSessionSubscription = this.sessions.list.subscribe(() => { this.syncActiveSession() })
    this.mountAll()
    this.observer = new MutationObserver(records => {
      if (records.some(mutationNeedsMount)) this.scheduler?.schedule()
    })
    this.observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-details-collapsed', 'data-sidebar-collapsed'],
      childList: true,
      subtree: true,
    })
  }

  dispose(): void {
    this.stopSessionSubscription?.()
    this.stopActiveStoreSubscription?.()
    this.observer?.disconnect()
    this.scheduler?.cancel()
    this.dock.root?.unmount()
    this.trigger.root?.unmount()
    this.dock.element?.remove()
    this.trigger.element?.remove()
    this.style?.remove()
    this.surfaces.clear()
    this.active = undefined
  }

  isBottomPanelOpen(): boolean {
    return this.active !== undefined && !this.active.store.getState().collapsed
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  toggleBottomPanel(): void {
    if (this.active === undefined) this.syncActiveSession()
    if (this.active !== undefined) openOrToggleTerminal(this.active.store)
  }

  toggleSidebar(): void {
    this.layout.toggleSidebar()
  }

  private surfaceFor(scopeKey: string, cwd: string | null): SessionSurface {
    const existing = this.surfaces.get(scopeKey)
    if (existing !== undefined) {
      existing.cwd = cwd
      return existing
    }
    const surface = {
      scopeKey,
      cwd,
      store: createDockStore(window.localStorage, scopeKey),
    }
    this.surfaces.set(scopeKey, surface)
    return surface
  }

  private syncActiveSession(): void {
    const session = currentSession(this.sessions)
    const previous = this.active
    const previousCwd = previous?.cwd
    const next = this.surfaceFor(session.scopeKey, session.cwd)
    if (previous === next && previousCwd === session.cwd) return
    if (previous !== next) {
      this.stopActiveStoreSubscription?.()
      this.stopActiveStoreSubscription = next.store.subscribe(() => { this.notify() })
    }
    this.active = next
    this.renderDock()
    this.renderTrigger()
    this.scheduler?.schedule()
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  private mountAll(): void {
    const column = findConversationColumn()
    if (column === null) return
    this.mountDock(column)
    this.mountTrigger(column)
  }

  private mountDock(column: HTMLElement): void {
    if (this.dock.element === null) {
      const element = document.createElement('div')
      element.id = 'oh-dsh-terminal-root'
      element.style.display = 'contents'
      this.dock.element = element
      this.dock.root = createRoot(element)
    }
    if (this.dock.element.parentElement !== column || column.lastElementChild !== this.dock.element) {
      column.append(this.dock.element)
    }
    this.renderDock()
  }

  private mountTrigger(column: HTMLElement): void {
    const seat = findTriggerSeat(column)
    if (seat === null) return
    if (this.trigger.element === null) {
      const element = document.createElement('div')
      element.id = 'oh-dsh-terminal-trigger-root'
      element.style.marginLeft = 'auto'
      this.trigger.element = element
      this.trigger.root = createRoot(element)
    }
    if (this.trigger.element.parentElement !== seat) seat.append(this.trigger.element)
    this.renderTrigger()
  }

  private renderDock(): void {
    const active = this.active
    if (this.dock.root === null || active === undefined) return
    this.dock.root.render(
      <Fragment>
        {[...this.surfaces.values()].map(surface => (
          <div
            key={surface.scopeKey}
            style={{ display: surface === active ? 'contents' : 'none' }}
          >
            <TerminalPanel
              store={surface.store}
              scopeKey={surface.scopeKey}
              cwd={surface.cwd}
              active={surface === active}
            />
          </div>
        ))}
      </Fragment>,
    )
  }

  private renderTrigger(): void {
    if (this.trigger.root !== null && this.active !== undefined) {
      this.trigger.root.render(<TerminalTrigger store={this.active.store} />)
    }
  }
}

export function apply(ctx: ClientContext): void {
  const service = new DesktopPanelService(
    ctx.get('layout') as LayoutService,
    ctx.get('sessions') as SessionsService,
  )
  ctx.effect(() => {
    service.mount()
    const removeService = ctx.reflect.provide('desktopPanels', service, undefined)
    return () => {
      service.dispose()
      void removeService?.()
    }
  }, 'oh-dsh-desktop: terminal panel controls')
}
