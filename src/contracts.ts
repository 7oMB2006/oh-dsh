/** Commands sent from Electron's native chrome to the DSH client plugin. */
export type DesktopCommand =
  | { type: 'focus-composer' }
  | { type: 'new-session' }
  | { type: 'open-paths'; paths: string[] }
  | { type: 'show-settings' }
  | { type: 'toggle-bottom-panel' }
  | { type: 'toggle-panel-maximized' }
  | { type: 'toggle-pinned-summary' }
  | { type: 'toggle-side-panel' }
  | { type: 'toggle-workspace-panel' }
  | { type: 'open-browser' }
  | { type: 'open-files' }
  | { type: 'open-review' }
  | { type: 'open-side-chat' }
  | { type: 'open-trajectory' }
  | { type: 'toggle-sidebar' }

/** Public facts exposed by the isolated Electron preload. */
export interface DesktopInfo {
  appDataPath: string
  dshHome: string
  platform: NodeJS.Platform
  profile: string
  version: string
}

/** Runtime diagnostics shown by the bundled bottom-panel plugin. */
export interface DesktopRuntimeSnapshot {
  bundledPlugins: string[]
  logTail: string[]
  profile: string
  runtimeUrl: string | null
  status: 'ready' | 'restarting' | 'stopped'
}

/** Browser-safe desktop bridge made available through contextBridge. */
export interface DesktopBridge {
  chooseWorkspace(): Promise<string[]>
  getInfo(): Promise<DesktopInfo>
  getRuntimeSnapshot(): Promise<DesktopRuntimeSnapshot>
  onCommand(listener: (command: DesktopCommand) => void): () => void
  openExternal(url: string): Promise<void>
}
