/** Host face for the native Oh-DSH-Desktop surface. */

import { mountDesktopTerminal, type DesktopTerminalContext } from './terminal/server.ts'

interface SystemPromptService {
  section(entry: {
    name: string
    order: number
    text: () => string
  }): unknown
}

interface BashEnvService {
  register(entry: {
    name: string
    variables: Record<string, { description: string }>
    resolve: () => Record<string, string>
  }): unknown
}

interface HostServices {
  systemPrompt: SystemPromptService
  bashEnv: BashEnvService
}

interface HostContext extends DesktopTerminalContext {
  inject(names: string[], callback: (ctx: HostContext & HostServices) => void): void
  provide(name: string, value: unknown): void
  effect(effect: () => (() => void) | void, label?: string): void
}

/** Stable Cordis plugin name. */
export const name = 'oh-dsh-desktop-shell'

/** The desktop surface needs the loopback server before publishing facts. */
export const inject = ['httpServer']

/** Immutable Host-side desktop capability published to other DSH plugins. */
export interface DesktopHostCapability {
  appDataPath: string
  kind: 'electron'
  platform: NodeJS.Platform
  profile: string
  version: string
}

function environmentCapability(): DesktopHostCapability {
  return Object.freeze({
    appDataPath: process.env.DSH_DESKTOP_APP_DATA ?? '',
    kind: 'electron',
    platform: process.platform,
    profile: process.env.DSH_DESKTOP_PROFILE ?? 'desktop',
    version: process.env.DSH_DESKTOP_VERSION ?? '0.0.0',
  })
}

function desktopPrompt(capability: DesktopHostCapability): string {
  return `You are interacting with the user through Oh-DSH-Desktop ${capability.version} on ${capability.platform}. `
    + 'Oh-DSH-Desktop is an Electron distribution backed by DeepSeek Harness. '
    + 'Native window actions, workspaces, panels, files, tools, skills, subagents, and other agent capabilities are composed through DSH plugins. '
    + 'When the user says “this app” without naming another target, they mean Oh-DSH-Desktop. '
    + 'Identify this surface as Oh-DSH-Desktop backed by DeepSeek Harness.'
}

/** Mount the native desktop capability in the DSH graph. */
export function apply(ctx: HostContext): void {
  const capability = environmentCapability()
  ctx.provide('desktop', capability)
  ctx.effect(() => mountDesktopTerminal(ctx), 'oh-dsh-desktop: terminal websocket')

  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'app:oh-dsh-desktop-surface',
      order: -98,
      text: () => desktopPrompt(capability),
    })
  })

  ctx.inject(['bashEnv'], (runtimeCtx) => {
    runtimeCtx.bashEnv.register({
      name: 'oh-dsh-desktop-runtime',
      variables: {
        DSH_DESKTOP: { description: 'Set to 1 inside the Oh-DSH-Desktop distribution.' },
        DSH_DESKTOP_APP_DATA: { description: 'Writable application-data root owned by Oh-DSH-Desktop.' },
        DSH_DESKTOP_PROFILE: { description: 'DSH profile mounted by Oh-DSH-Desktop.' },
        DSH_DESKTOP_VERSION: { description: 'Installed Oh-DSH-Desktop version.' },
      },
      resolve: () => ({
        DSH_DESKTOP: '1',
        DSH_DESKTOP_APP_DATA: capability.appDataPath,
        DSH_DESKTOP_PROFILE: capability.profile,
        DSH_DESKTOP_VERSION: capability.version,
      }),
    })
  })
}
