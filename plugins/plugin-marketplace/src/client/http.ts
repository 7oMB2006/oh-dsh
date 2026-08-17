import type {
  MarketplaceCommand,
  MarketplaceSnapshot,
  PluginMarketplaceBridge,
} from '../protocol.ts'

function isSnapshot(value: unknown): value is MarketplaceSnapshot {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'catalog' in value
    && Array.isArray((value as { catalog?: unknown }).catalog)
}

async function responseError(response: Response): Promise<Error> {
  try {
    const value = await response.json() as { error?: unknown }
    if (typeof value.error === 'string' && value.error !== '') {
      return new Error(value.error)
    }
  } catch {
    // Fall through to the status-based error.
  }
  return new Error(`plugin marketplace bridge failed with HTTP ${String(response.status)}`)
}

/** Same-origin HTTP transport used by the Oh-DSH Web client. */
export function createMarketplaceHttpBridge(
  path: string,
  fetcher: typeof fetch = fetch,
): PluginMarketplaceBridge {
  return Object.freeze({
    async dispatch(command: MarketplaceCommand): Promise<MarketplaceSnapshot> {
      const response = await fetcher(path, {
        body: JSON.stringify(command),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      if (response.ok === false) throw await responseError(response)
      const value = await response.json() as unknown
      if (!isSnapshot(value)) throw new Error('plugin marketplace bridge returned an invalid snapshot')
      return value
    },
    async getSnapshot(): Promise<MarketplaceSnapshot> {
      const response = await fetcher(path, { method: 'GET' })
      if (response.ok === false) throw await responseError(response)
      const value = await response.json() as unknown
      if (!isSnapshot(value)) throw new Error('plugin marketplace bridge returned an invalid snapshot')
      return value
    },
  })
}


function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, milliseconds) })
}

/**
 * Wait for the Web marketplace host to restart after apply/undo. The old
 * host answers the apply dispatch and then exits; polling begins only after
 * that host is unreachable, then waits for the replacement to serve the
 * bridge again.
 */
export async function waitForMarketplaceRestart(
  path: string,
  unavailableTimeoutMs = 20_000,
  readyTimeoutMs = 60_000,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const unavailableStart = Date.now()
  while (Date.now() - unavailableStart < unavailableTimeoutMs) {
    try {
      const response = await fetcher(path, { cache: 'no-store', method: 'GET' })
      if (response.ok === false) break
      await delay(250)
    } catch {
      break
    }
  }
  const readyStart = Date.now()
  while (Date.now() - readyStart < readyTimeoutMs) {
    try {
      const response = await fetcher(path, { cache: 'no-store', method: 'GET' })
      if (response.ok) return
    } catch {
      // The replacement runtime is still starting.
    }
    await delay(400)
  }
  throw new Error('plugin marketplace did not become ready after restart')
}
