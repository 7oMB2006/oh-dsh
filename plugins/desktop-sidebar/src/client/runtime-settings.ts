import {
  betterSidebarApi,
  type BetterSidebarSettingsView,
} from './better-sidebar-api.ts'

export interface SidebarRuntimePreferences {
  agentTerminalTools: boolean
  bottomPanelAutoTerminal: boolean
  browserInterceptLinks: boolean
  interceptOpenPath: boolean
}

export const DEFAULT_SIDEBAR_RUNTIME_PREFERENCES:
Readonly<SidebarRuntimePreferences> = Object.freeze({
  agentTerminalTools: false,
  bottomPanelAutoTerminal: true,
  browserInterceptLinks: true,
  interceptOpenPath: true,
})

export interface SidebarRuntimeSettingsSnapshot {
  busy: boolean
  error: 'load' | 'save' | null
  preferences: Readonly<SidebarRuntimePreferences>
  revision: number | undefined
}

interface SidebarRuntimeSettingsApi {
  settingsGet(signal?: AbortSignal): Promise<BetterSidebarSettingsView>
  settingsUpdate(
    patch: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<BetterSidebarSettingsView>
}

export function parseSidebarRuntimePreferences(
  value: unknown,
): SidebarRuntimePreferences {
  const record = value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  return {
    agentTerminalTools: typeof record.agentTerminalTools === 'boolean'
      ? record.agentTerminalTools
      : DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.agentTerminalTools,
    bottomPanelAutoTerminal:
      typeof record.bottomPanelAutoTerminal === 'boolean'
        ? record.bottomPanelAutoTerminal
        : DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.bottomPanelAutoTerminal,
    browserInterceptLinks: typeof record.browserInterceptLinks === 'boolean'
      ? record.browserInterceptLinks
      : DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.browserInterceptLinks,
    interceptOpenPath: typeof record.interceptOpenPath === 'boolean'
      ? record.interceptOpenPath
      : DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.interceptOpenPath,
  }
}

function snapshotFromView(
  view: BetterSidebarSettingsView,
): SidebarRuntimeSettingsSnapshot {
  return {
    busy: false,
    error: null,
    preferences: parseSidebarRuntimePreferences(view.value),
    revision: view.revision,
  }
}

export class SidebarRuntimeSettingsService {
  private readonly listeners = new Set<() => void>()
  private queue: Promise<unknown> = Promise.resolve()
  private readonly api: SidebarRuntimeSettingsApi
  private snapshot: SidebarRuntimeSettingsSnapshot = {
    busy: true,
    error: null,
    preferences: { ...DEFAULT_SIDEBAR_RUNTIME_PREFERENCES },
    revision: undefined,
  }

  constructor(api: SidebarRuntimeSettingsApi = betterSidebarApi) {
    this.api = api
  }

  getSnapshot = (): SidebarRuntimeSettingsSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async start(): Promise<void> {
    this.publish({ ...this.snapshot, busy: true, error: null })
    try {
      this.publish(snapshotFromView(await this.api.settingsGet()))
    } catch {
      this.publish({ ...this.snapshot, busy: false, error: 'load' })
    }
  }

  update(patch: Partial<SidebarRuntimePreferences>): Promise<void> {
    const run = this.queue.then(async () => {
      const previous = this.snapshot
      this.publish({
        ...previous,
        busy: true,
        error: null,
        preferences: { ...previous.preferences, ...patch },
      })
      try {
        const view = await this.api.settingsUpdate(patch, previous.revision)
        this.publish(snapshotFromView(view))
      } catch {
        this.publish({ ...previous, busy: false, error: 'save' })
      }
    })
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  reset(): Promise<void> {
    return this.update({ ...DEFAULT_SIDEBAR_RUNTIME_PREFERENCES })
  }

  dispose(): void {
    this.listeners.clear()
  }

  private publish(snapshot: SidebarRuntimeSettingsSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}
