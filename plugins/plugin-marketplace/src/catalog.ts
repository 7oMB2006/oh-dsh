import type {
  MarketplaceInstalledPlugin,
  MarketplaceMechanism,
  MarketplacePlugin,
} from './protocol.ts'
import {
  isProtectedMarketplacePlugin,
  MARKETPLACE_ORGANIZATION,
} from './protocol.ts'

export interface MarketplaceCatalog {
  generatedAt: string | null
  plugins: MarketplacePlugin[]
}

interface CatalogRepository {
  bundle?: unknown
  category?: unknown
  description?: unknown
  empty?: unknown
  hide?: unknown
  name?: unknown
  note?: unknown
  pushedAt?: unknown
  repository?: unknown
  tags?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function mechanism(row: CatalogRepository): MarketplaceMechanism {
  if (row.bundle === true) return 'bundle'
  if (row.repository === true) return 'repository'
  return 'unsupported'
}

function runtimeRisk(value: MarketplaceMechanism): MarketplacePlugin['runtimeRisk'] {
  if (value === 'bundle') return 'profile-bundle'
  if (value === 'repository') return 'trusted-host'
  return 'guided'
}

function validRepositoryName(value: string): boolean {
  return /^[A-Za-z0-9_.-]{1,100}$/.test(value)
}

/** Parse the organization catalog without trusting paths or URLs from it. */
export function parseMarketplaceCatalog(
  value: unknown,
  installed: readonly MarketplaceInstalledPlugin[] = [],
): MarketplaceCatalog {
  if (!isRecord(value) || value.schema !== 'dsh-external-hub/v0.1'
    || !Array.isArray(value.repos)) {
    throw new Error('unsupported dsh-external plugin catalog')
  }
  const installedIds = new Set(installed.map(entry => entry.pluginId))
  const plugins: MarketplacePlugin[] = []
  for (const candidate of value.repos) {
    if (!isRecord(candidate)) continue
    const row = candidate as CatalogRepository
    const id = cleanString(row.name)
    if (id === null || !validRepositoryName(id) || row.hide === true || row.empty === true) continue
    const tags = Array.isArray(row.tags)
      ? row.tags.flatMap(tag => cleanString(tag) === null ? [] : [cleanString(tag) as string]).slice(0, 16)
      : []
    const installMechanism = mechanism(row)
    plugins.push({
      category: cleanString(row.category) ?? 'other',
      currentCommit: null,
      description: cleanString(row.note) ?? cleanString(row.description) ?? 'No description provided.',
      enabled: false,
      id,
      installed: installedIds.has(id),
      latestCommit: null,
      mechanism: installMechanism,
      protected: isProtectedMarketplacePlugin(id),
      pushedAt: cleanString(row.pushedAt),
      runtimeRisk: runtimeRisk(installMechanism),
      tags,
      title: id,
      trust: 'organization',
      updateAvailable: false,
      url: `https://github.com/${MARKETPLACE_ORGANIZATION}/${id}`,
    })
  }
  plugins.sort((left, right) => {
    if (left.installed !== right.installed) return left.installed ? -1 : 1
    if (left.mechanism === 'unsupported' && right.mechanism !== 'unsupported') return 1
    if (right.mechanism === 'unsupported' && left.mechanism !== 'unsupported') return -1
    return left.title.localeCompare(right.title)
  })
  return {
    generatedAt: cleanString(value.generated),
    plugins,
  }
}
