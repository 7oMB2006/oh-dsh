export const MARKETPLACE_ORGANIZATION = 'dsh-external'
export const MARKETPLACE_CATALOG_REPOSITORY = 'hub'

export type MarketplaceAuthStatus = 'ready' | 'missing-cli' | 'signed-out' | 'error'
export type MarketplaceMechanism = 'bundle' | 'repository' | 'unsupported'
export type MarketplaceAction = 'install' | 'update' | 'enable' | 'disable' | 'uninstall'
export type MarketplaceRuntimeRisk = 'profile-bundle' | 'trusted-host' | 'guided'
export type MarketplaceTrust = 'community'

export interface MarketplacePlugin {
  category: string
  description: string
  currentCommit: string | null
  enabled: boolean
  id: string
  installed: boolean
  latestCommit: string | null
  mechanism: MarketplaceMechanism
  pushedAt: string | null
  runtimeRisk: MarketplaceRuntimeRisk
  tags: string[]
  title: string
  trust: MarketplaceTrust
  updateAvailable: boolean
  url: string
}

export interface MarketplaceInstalledPlugin {
  installedAt: string
  mechanism: Exclude<MarketplaceMechanism, 'unsupported'>
  packageName: string | null
  pluginId: string
  resolvedCommit: string
  source: string
}

export interface MarketplacePlan {
  action: MarketplaceAction
  buildScripts: Record<string, string>
  description: string
  mechanism: Exclude<MarketplaceMechanism, 'unsupported'>
  packageName: string | null
  pluginId: string
  resolvedCommit: string
  source: string
}

export interface MarketplacePreview {
  action: MarketplaceAction
  pluginId: string
  resolvedCommit: string
  startedAt: string
  transactionId: string
}

export interface MarketplaceSnapshot {
  auth: {
    detail: string
    status: MarketplaceAuthStatus
  }
  busy: boolean
  catalog: MarketplacePlugin[]
  catalogGeneratedAt: string | null
  error: string | null
  installed: MarketplaceInstalledPlugin[]
  lastAction: string | null
  plan: MarketplacePlan | null
  preview: MarketplacePreview | null
  undoAvailable: boolean
}

export type MarketplaceCommand =
  | { type: 'refresh' }
  | { type: 'inspect'; action: MarketplaceAction; pluginId: string }
  | { type: 'preview'; allowBuildScripts: boolean }
  | { type: 'discard' }
  | { type: 'apply' }
  | { type: 'undo' }

export interface PluginMarketplaceBridge {
  dispatch(command: MarketplaceCommand): Promise<MarketplaceSnapshot>
  getSnapshot(): Promise<MarketplaceSnapshot>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Validate untrusted renderer input before it reaches filesystem operations. */
export function parseMarketplaceCommand(value: unknown): MarketplaceCommand {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error('marketplace command must be an object with a type')
  }
  if (value.type === 'refresh' || value.type === 'discard'
    || value.type === 'apply' || value.type === 'undo') {
    return { type: value.type }
  }
  if (value.type === 'inspect') {
    if (!['install', 'update', 'enable', 'disable', 'uninstall'].includes(String(value.action))
      || typeof value.pluginId !== 'string') {
      throw new Error('invalid marketplace inspect command')
    }
    return {
      type: 'inspect',
      action: value.action as MarketplaceAction,
      pluginId: value.pluginId,
    }
  }
  if (value.type === 'preview' && typeof value.allowBuildScripts === 'boolean') {
    return { type: 'preview', allowBuildScripts: value.allowBuildScripts }
  }
  throw new Error(`unsupported marketplace command: ${value.type}`)
}
