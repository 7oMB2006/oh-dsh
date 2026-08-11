/** Browser face for the native Oh-DSH-Desktop bridge. */

import type { DesktopBridge, DesktopCommand } from '../../../src/contracts.ts'
import type { DesktopPanels } from '../../panel-controls/src/client.ts'
import type { PinnedSummary } from '../../pinned-summary/src/client.ts'
import type { WorkspaceTools } from '../../workspace-tools/src/client.ts'

interface WorkspaceView {
  workspaceId: string
}

interface WorkspacesService {
  create(input: { path: string }): Promise<WorkspaceView>
  startSession(workspaceId?: string): void
}

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  reflect: { provide(name: string, value: unknown, options?: unknown): void }
}

declare global {
  interface Window {
    dshDesktop?: DesktopBridge
  }
}

const DESKTOP_TITLEBAR_HEIGHT = 40

const DESKTOP_CHROME_CSS = `
html[data-oh-dsh-desktop='true'] {
  --oh-dsh-titlebar-height: ${DESKTOP_TITLEBAR_HEIGHT}px;
}

html[data-oh-dsh-desktop='true'] body {
  box-sizing: border-box;
  padding-top: var(--oh-dsh-titlebar-height);
}

html[data-oh-dsh-desktop='true'] body::before {
  content: '';
  position: fixed;
  z-index: 2147483647;
  top: 0;
  right: 0;
  left: 0;
  height: var(--oh-dsh-titlebar-height);
  background: var(--dsw-alias-bg-base);
  -webkit-app-region: drag;
  user-select: none;
}
`

/** Wait for the DSH services used by native menu commands. */
export const inject = ['workspaces', 'desktopPanels', 'pinnedSummary', 'workspaceTools']

function installDesktopChrome(): () => void {
  const originalTitle = document.title
  const style = document.createElement('style')
  style.dataset.ohDshDesktopChrome = 'true'
  style.textContent = DESKTOP_CHROME_CSS
  document.head.append(style)
  document.documentElement.dataset.ohDshDesktop = 'true'
  document.title = 'Oh-DSH-Desktop'
  return () => {
    style.remove()
    delete document.documentElement.dataset.ohDshDesktop
    document.title = originalTitle
  }
}

function focusComposer(): void {
  document.querySelector<HTMLTextAreaElement>('textarea')?.focus()
}

function showSettings(): void {
  document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click()
}

async function openPaths(workspaces: WorkspacesService, paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    const workspace = await workspaces.create({ path })
    workspaces.startSession(workspace.workspaceId)
  }
}

function dispatch(
  command: DesktopCommand,
  workspaces: WorkspacesService,
  panels: DesktopPanels,
  pinnedSummary: PinnedSummary,
  workspaceTools: WorkspaceTools,
): void {
  switch (command.type) {
    case 'focus-composer':
      focusComposer()
      return
    case 'new-session':
      workspaces.startSession()
      return
    case 'open-paths':
      void openPaths(workspaces, command.paths).catch((error: unknown) => {
        console.error('oh-dsh-desktop: failed to open workspace', error)
      })
      return
    case 'show-settings':
      showSettings()
      return
    case 'toggle-sidebar':
      panels.toggleSidebar()
      return
    case 'toggle-bottom-panel':
      panels.toggleBottomPanel()
      return
    case 'toggle-panel-maximized':
      workspaceTools.togglePanelMaximized()
      return
    case 'toggle-pinned-summary':
      workspaceTools.setOpen(false)
      pinnedSummary.toggle()
      return
    case 'toggle-workspace-panel':
      workspaceTools.toggle()
      return
    case 'toggle-side-panel':
      workspaceTools.toggleSidePanel()
      return
    case 'open-browser':
      workspaceTools.openBrowser()
      return
    case 'open-files':
      workspaceTools.openFiles()
      return
    case 'open-review':
      workspaceTools.openReview()
      return
    case 'open-side-chat':
      void workspaceTools.openSideChat().catch((error: unknown) => {
        console.error('oh-dsh-desktop: failed to open side chat', error)
      })
      return
    case 'open-trajectory':
      workspaceTools.openTrajectory()
      return
    default:
      command satisfies never
  }
}

/** Enroll the isolated Electron bridge and map native actions to DSH services. */
export function apply(ctx: ClientContext): void {
  const bridge = window.dshDesktop
  if (bridge === undefined) {
    throw new Error('oh-dsh-desktop: preload bridge is unavailable outside Oh-DSH-Desktop')
  }
  const workspaces = ctx.get('workspaces') as WorkspacesService
  const panels = ctx.get('desktopPanels') as DesktopPanels
  const pinnedSummary = ctx.get('pinnedSummary') as PinnedSummary
  const workspaceTools = ctx.get('workspaceTools') as WorkspaceTools
  ctx.reflect.provide('desktopShell', bridge, undefined)
  ctx.effect(() => {
    const removeDesktopChrome = installDesktopChrome()
    const unsubscribe = bridge.onCommand((command) => {
      dispatch(command, workspaces, panels, pinnedSummary, workspaceTools)
    })
    return () => {
      unsubscribe()
      removeDesktopChrome()
    }
  }, 'oh-dsh-desktop: native command bridge')
}
