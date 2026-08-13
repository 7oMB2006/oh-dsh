import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  hasBrowserSurface,
  OH_DSH_SURFACE_SERVICE,
  OH_DSH_SURFACE_VIEW_SERVICE,
  type OhDshSurface,
} from '../plugins/shared/surface.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('surface contract defines exactly the three Oh-DSH forms', () => {
  assert.equal(OH_DSH_SURFACE_SERVICE, 'ohDshSurface')
  assert.equal(OH_DSH_SURFACE_VIEW_SERVICE, 'ohDshSurface')
  const surface: OhDshSurface = {
    dataRoot: '/data',
    kind: 'desktop',
    platform: 'darwin',
    profile: 'desktop',
    version: '0.1.2',
  }
  assert.equal(surface.kind, 'desktop')
  assert.deepEqual(
    (['desktop', 'web', 'tui'] as const).map(kind => hasBrowserSurface(kind)),
    [true, true, false],
  )
  assert.equal(hasBrowserSurface(undefined), false)
})

test('every bundled plugin adapts explicitly per surface', () => {
  const skins = readFileSync(join(root, 'plugins/skins/src/index.ts'), 'utf8')
  assert.match(skins, /OH_DSH_SURFACE_SERVICE/)
  assert.match(skins, /hasBrowserSurface/)
  assert.match(skins, /no browser surface; skin preferences disabled/)

  const sidebar = readFileSync(join(root, 'plugins/sidebar/src/index.ts'), 'utf8')
  assert.match(sidebar, /export const inject = \['webServer'\]/)
  assert.doesNotMatch(sidebar, /inject = \['desktop', 'webServer'\]/)
  assert.match(sidebar, /OH_DSH_SURFACE_SERVICE/)
  assert.match(sidebar, /hasBrowserSurface/)
  assert.match(sidebar, /no browser surface; sidebar host disabled/)

  const marketplace = readFileSync(
    join(root, 'plugins/plugin-marketplace/src/client/plugin.tsx'),
    'utf8',
  )
  assert.doesNotMatch(marketplace, /Electron bridge is unavailable'\)/)
  assert.match(marketplace, /plugin-marketplace: skipped, the plugin marketplace is desktop-only/)

  const desktopHost = readFileSync(join(root, 'src/plugin.ts'), 'utf8')
  assert.match(desktopHost, /kind: 'desktop'/)
  assert.match(desktopHost, /OH_DSH_SURFACE_SERVICE/)

  const webHost = readFileSync(join(root, 'web/src/index.ts'), 'utf8')
  assert.match(webHost, /kind: 'web'/)
  assert.match(webHost, /OH_DSH_SURFACE_SERVICE/)

  const webClient = readFileSync(join(root, 'web/src/client.ts'), 'utf8')
  assert.match(webClient, /kind: 'web'/)
  assert.match(webClient, /OH_DSH_SURFACE_VIEW_SERVICE/)
})
