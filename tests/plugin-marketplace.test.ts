import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseMarketplaceCatalog } from '../plugins/plugin-marketplace/src/catalog.ts'
import type {
  DshCommandInput,
  MarketplaceAuthResult,
  MarketplacePlatform,
} from '../plugins/plugin-marketplace/src/host/platform.ts'
import { withGitHubCredentials } from '../plugins/plugin-marketplace/src/host/platform.ts'
import {
  PluginMarketplaceManager,
  type MarketplacePreviewRuntimeInput,
  type MarketplaceRuntime,
} from '../plugins/plugin-marketplace/src/host/transaction-manager.ts'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const UPDATED_COMMIT = 'fedcba9876543210fedcba9876543210fedcba98'

function catalogDocument(): unknown {
  return {
    schema: 'dsh-external-hub/v0.1',
    generated: '2026-08-10T17:17:56.572Z',
    repos: [
      {
        name: 'bundle-demo',
        category: 'plugin',
        description: 'Bundle demo',
        bundle: true,
        repository: false,
        tags: ['web-ui'],
        pushedAt: '2026-08-10T12:00:00Z',
      },
      {
        name: 'repository-demo',
        category: 'skill',
        note: 'Repository demo',
        bundle: false,
        repository: true,
      },
      {
        name: 'hybrid-demo',
        category: 'plugin',
        bundle: true,
        repository: true,
      },
      { name: 'legacy-demo', category: 'plugin', bundle: false, repository: false },
      { name: 'hidden-demo', category: 'plugin', bundle: true, hide: true },
      { name: '../escape', category: 'plugin', bundle: true },
    ],
  }
}

class FakePlatform implements MarketplacePlatform {
  readonly commands: DshCommandInput[] = []
  latestCommit = COMMIT

  async authStatus(): Promise<MarketplaceAuthResult> {
    return { detail: 'test auth', status: 'ready' }
  }

  async cloneRepository(_pluginId: string, _commit: string, target: string): Promise<void> {
    mkdirSync(target, { recursive: true })
  }

  async loadCatalog(): Promise<unknown> {
    return catalogDocument()
  }

  async readRepositoryFile(pluginId: string, path: string): Promise<string | null> {
    if (pluginId === 'bundle-demo' && path === 'package.json') {
      return JSON.stringify({
        name: '@example/bundle-demo',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
        scripts: { prepare: 'node build.mjs', test: 'node test.mjs' },
      })
    }
    if (pluginId === 'repository-demo' && path === '.dsh-plugin/package.json') {
      return JSON.stringify({ name: '@example/repository-demo', scripts: { prepack: 'dsh-plugin-prepare' } })
    }
    return null
  }

  async resolveCommit(): Promise<string> {
    return this.latestCommit
  }

  async runDsh(input: DshCommandInput): Promise<void> {
    this.commands.push(input)
    const profile = join(input.dshHome, 'profiles', 'desktop', 'package.json')
    const manifest = JSON.parse(readFileSync(profile, 'utf8'))
    if (input.args.includes('add')) {
      manifest.dependencies['@example/bundle-demo'] = `link:${input.args.at(-1) as string}`
      if (!manifest.dsh.profile.bundles.includes('@example/bundle-demo')) {
        manifest.dsh.profile.bundles.push('@example/bundle-demo')
      }
    } else if (input.args.includes('remove')) {
      delete manifest.dependencies['@example/bundle-demo']
      manifest.dsh.profile.bundles = manifest.dsh.profile.bundles
        .filter((entry: string) => entry !== '@example/bundle-demo')
    }
    writeFileSync(profile, JSON.stringify(manifest, undefined, 2) + '\n')
  }
}

class FakeRuntime implements MarketplaceRuntime {
  liveStarts = 0
  liveStops = 0
  previewStarts: MarketplacePreviewRuntimeInput[] = []
  previewStops = 0

  async startLive(): Promise<void> { this.liveStarts += 1 }
  async stopLive(): Promise<void> { this.liveStops += 1 }
  async startPreview(input: MarketplacePreviewRuntimeInput): Promise<void> { this.previewStarts.push(input) }
  async stopPreview(): Promise<void> { this.previewStops += 1 }
}

function fixture(): {
  appDataPath: string
  cleanup(): void
  dshHome: string
  manager: PluginMarketplaceManager
  platform: FakePlatform
  profileDir: string
  runtime: FakeRuntime
} {
  const appDataPath = mkdtempSync(join(tmpdir(), 'oh-dsh-marketplace-'))
  const dshHome = join(appDataPath, 'dsh')
  const profileDir = join(dshHome, 'profiles', 'desktop')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'desktop',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@oh-dsh/desktop'] } },
  }, undefined, 2) + '\n')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  const platform = new FakePlatform()
  const runtime = new FakeRuntime()
  const manager = new PluginMarketplaceManager({
    appDataPath,
    dshHome,
    platform,
    profile: 'desktop',
    runtime,
  })
  return {
    appDataPath,
    cleanup: () => { rmSync(appDataPath, { recursive: true, force: true }) },
    dshHome,
    manager,
    platform,
    profileDir,
    runtime,
  }
}

test('catalog parser keeps safe entries and labels unsupported managers', () => {
  const catalog = parseMarketplaceCatalog(catalogDocument())
  assert.equal(catalog.generatedAt, '2026-08-10T17:17:56.572Z')
  assert.deepEqual(catalog.plugins.map(plugin => [plugin.id, plugin.mechanism]), [
    ['bundle-demo', 'bundle'],
    ['hybrid-demo', 'bundle'],
    ['repository-demo', 'repository'],
    ['legacy-demo', 'unsupported'],
  ])
  assert.equal(
    catalog.plugins.find(plugin => plugin.id === 'repository-demo')?.description,
    'Repository demo',
  )
  assert.equal(catalog.plugins[0]?.url, 'https://github.com/dsh-external/bundle-demo')
})

test('GitHub credentials use an app-owned config without command-line pairs', () => {
  const appDataPath = mkdtempSync(join(tmpdir(), 'oh-dsh-git-config-'))
  try {
    const environment = withGitHubCredentials({
      DSH_DESKTOP_APP_DATA: appDataPath,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'unsafe.key',
      GIT_CONFIG_VALUE_0: 'unsafe value',
    }, '/opt/homebrew/bin/gh')
    assert.equal(environment.GIT_CONFIG_COUNT, undefined)
    assert.equal(environment.GIT_CONFIG_KEY_0, undefined)
    assert.equal(environment.GIT_CONFIG_VALUE_0, undefined)
    assert.equal(
      environment.GIT_CONFIG_GLOBAL,
      join(appDataPath, 'plugin-marketplace', 'gitconfig'),
    )
    const config = readFileSync(environment.GIT_CONFIG_GLOBAL, 'utf8')
    assert.match(config, /credential "https:\/\/github\.com"/)
    assert.match(config, /helper = !"\/opt\/homebrew\/bin\/gh" auth git-credential/)
    assert.doesNotMatch(config, /token|unsafe/i)
  } finally {
    rmSync(appDataPath, { recursive: true, force: true })
  }
})

test('a client reconnect during apply does not leave a sticky busy error', async () => {
  const setup = fixture()
  try {
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    setup.platform.loadCatalog = async (): Promise<unknown> => {
      await gate
      return catalogDocument()
    }
    const refresh = setup.manager.dispatch({ type: 'refresh' })
    await new Promise(resolve => { setImmediate(resolve) })
    const reconnect = await setup.manager.dispatch({ type: 'refresh' })
    assert.equal(reconnect.busy, true)
    assert.equal(reconnect.error, null)
    release?.()
    const settled = await refresh
    assert.equal(settled.busy, false)
    assert.equal(settled.error, null)
  } finally {
    setup.cleanup()
  }
})

test('marketplace navigation reserves room for Settings in short windows', () => {
  const client = readFileSync(new URL(
    '../plugins/plugin-marketplace/src/client/plugin.tsx',
    import.meta.url,
  ), 'utf8')
  const css = readFileSync(new URL(
    '../plugins/plugin-marketplace/src/client/marketplace.css',
    import.meta.url,
  ), 'utf8')
  const messages = readFileSync(new URL(
    '../plugins/plugin-marketplace/src/client/i18n.ts',
    import.meta.url,
  ), 'utf8')
  assert.match(client, /window\.innerHeight - top/)
  assert.match(client, /SIDEBAR_BOTTOM_INSET = 8/)
  assert.match(client, /--oh-marketplace-sidebar-height/)
  assert.match(css, /height: var\(--oh-marketplace-sidebar-height, 100%\) !important/)
  assert.match(client, /export const inject = \['locale'\]/)
  assert.match(client, /locale\.register\('oh-dsh\.plugin-marketplace'/)
  assert.match(client, /\['installed', t\('installed'\)\]/)
  assert.match(client, /\['available', t\('not-installed'\)\]/)
  assert.match(messages, /installed: '已安装'/)
  assert.match(messages, /'not-installed': '未安装'/)
  assert.match(client, /settingsDialogOpen\(\)/)
  assert.match(client, /document\.addEventListener\('click', this\.#handleDocumentClick, true\)/)
  assert.match(client, /button === settingsButton\(\)/)
  assert.match(client, /if \(disposed \|\| info\.preview !== null\) return/)
})

test('bundle preview remains isolated until apply and supports undo', async () => {
  const setup = fixture()
  try {
    let snapshot = await setup.manager.dispatch({ type: 'refresh' })
    assert.equal(snapshot.catalog.length, 4)
    snapshot = await setup.manager.dispatch({ type: 'inspect', action: 'install', pluginId: 'bundle-demo' })
    assert.deepEqual(snapshot.plan?.buildScripts, { prepare: 'node build.mjs' })

    snapshot = await setup.manager.dispatch({ type: 'preview', allowBuildScripts: false })
    assert.match(snapshot.error ?? '', /explicitly allow/)
    assert.equal(snapshot.preview, null)

    snapshot = await setup.manager.dispatch({ type: 'preview', allowBuildScripts: true })
    assert.equal(snapshot.error, null)
    assert.equal(snapshot.preview?.pluginId, 'bundle-demo')
    assert.equal(setup.runtime.previewStarts.length, 1)
    const liveBefore = JSON.parse(readFileSync(join(setup.profileDir, 'package.json'), 'utf8'))
    assert.deepEqual(liveBefore.dependencies, {})

    snapshot = await setup.manager.dispatch({ type: 'apply' })
    assert.equal(snapshot.preview, null)
    assert.equal(snapshot.undoAvailable, true)
    assert.equal(snapshot.installed[0]?.pluginId, 'bundle-demo')
    const liveAfter = JSON.parse(readFileSync(join(setup.profileDir, 'package.json'), 'utf8'))
    assert.match(
      liveAfter.dependencies['@example/bundle-demo'],
      /^link:\.oh-dsh\/sources\/bundle-demo-/,
    )
    assert.doesNotMatch(
      liveAfter.dependencies['@example/bundle-demo'],
      /plugin-marketplace\/previews/,
    )
    assert.equal(setup.platform.commands.length, 2)
    assert.deepEqual(setup.platform.commands[1]?.args.slice(-2), ['install', '--ignore-scripts'])
    assert.equal(setup.runtime.liveStops, 1)
    assert.equal(setup.runtime.liveStarts, 1)

    snapshot = await setup.manager.dispatch({ type: 'undo' })
    assert.equal(snapshot.undoAvailable, false)
    assert.deepEqual(snapshot.installed, [])
    const restored = JSON.parse(readFileSync(join(setup.profileDir, 'package.json'), 'utf8'))
    assert.deepEqual(restored.dependencies, {})
  } finally {
    setup.cleanup()
  }
})

test('installed bundles keep enabled state and update through isolated previews', async () => {
  const setup = fixture()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    await setup.manager.dispatch({
      type: 'inspect',
      action: 'install',
      pluginId: 'bundle-demo',
    })
    await setup.manager.dispatch({ type: 'preview', allowBuildScripts: true })
    let snapshot = await setup.manager.dispatch({ type: 'apply' })
    let plugin = snapshot.catalog.find(entry => entry.id === 'bundle-demo')
    assert.equal(plugin?.installed, true)
    assert.equal(plugin?.enabled, true)
    assert.equal(plugin?.currentCommit, COMMIT)
    assert.equal(plugin?.updateAvailable, false)

    await setup.manager.dispatch({
      type: 'inspect',
      action: 'disable',
      pluginId: 'bundle-demo',
    })
    await setup.manager.dispatch({ type: 'preview', allowBuildScripts: false })
    snapshot = await setup.manager.dispatch({ type: 'apply' })
    plugin = snapshot.catalog.find(entry => entry.id === 'bundle-demo')
    assert.equal(plugin?.installed, true)
    assert.equal(plugin?.enabled, false)
    let manifest = JSON.parse(readFileSync(join(setup.profileDir, 'package.json'), 'utf8'))
    assert.equal(typeof manifest.dependencies['@example/bundle-demo'], 'string')
    assert.ok(!manifest.dsh.profile.bundles.includes('@example/bundle-demo'))

    await setup.manager.dispatch({
      type: 'inspect',
      action: 'enable',
      pluginId: 'bundle-demo',
    })
    await setup.manager.dispatch({ type: 'preview', allowBuildScripts: false })
    snapshot = await setup.manager.dispatch({ type: 'apply' })
    plugin = snapshot.catalog.find(entry => entry.id === 'bundle-demo')
    assert.equal(plugin?.enabled, true)

    setup.platform.latestCommit = UPDATED_COMMIT
    snapshot = await setup.manager.dispatch({ type: 'refresh' })
    plugin = snapshot.catalog.find(entry => entry.id === 'bundle-demo')
    assert.equal(plugin?.latestCommit, UPDATED_COMMIT)
    assert.equal(plugin?.updateAvailable, true)

    await setup.manager.dispatch({
      type: 'inspect',
      action: 'update',
      pluginId: 'bundle-demo',
    })
    await setup.manager.dispatch({ type: 'preview', allowBuildScripts: true })
    snapshot = await setup.manager.dispatch({ type: 'apply' })
    plugin = snapshot.catalog.find(entry => entry.id === 'bundle-demo')
    assert.equal(plugin?.currentCommit, UPDATED_COMMIT)
    assert.equal(plugin?.updateAvailable, false)
    manifest = JSON.parse(readFileSync(join(setup.profileDir, 'package.json'), 'utf8'))
    assert.match(
      manifest.dependencies['@example/bundle-demo'],
      new RegExp(`bundle-demo-${UPDATED_COMMIT.slice(0, 12)}`),
    )
  } finally {
    setup.cleanup()
  }
})

test('repository preview can be discarded without changing the live patch', async () => {
  const setup = fixture()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    let snapshot = await setup.manager.dispatch({
      type: 'inspect',
      action: 'install',
      pluginId: 'repository-demo',
    })
    assert.equal(snapshot.plan?.mechanism, 'repository')
    snapshot = await setup.manager.dispatch({ type: 'preview', allowBuildScripts: true })
    assert.equal(snapshot.preview?.pluginId, 'repository-demo')
    assert.equal(readFileSync(join(setup.profileDir, 'cordis.patch.yml'), 'utf8'), '[]\n')
    const previewHome = setup.runtime.previewStarts[0]?.dshHome
    assert.ok(previewHome)
    const previewPatch = readFileSync(join(previewHome, 'profiles', 'desktop', 'cordis.patch.yml'), 'utf8')
    assert.doesNotMatch(previewPatch, /^\[\]\s*\n- id:/m)
    assert.match(previewPatch, /- id: repository-plugins/)
    snapshot = await setup.manager.dispatch({ type: 'discard' })
    assert.equal(snapshot.preview, null)
    assert.deepEqual(snapshot.installed, [])
    assert.equal(readFileSync(join(setup.profileDir, 'cordis.patch.yml'), 'utf8'), '[]\n')
  } finally {
    setup.cleanup()
  }
})

test('repository plugins can be disabled without losing their install receipt', async () => {
  const setup = fixture()
  try {
    await setup.manager.dispatch({ type: 'refresh' })
    await setup.manager.dispatch({
      type: 'inspect',
      action: 'install',
      pluginId: 'repository-demo',
    })
    await setup.manager.dispatch({ type: 'preview', allowBuildScripts: true })
    let snapshot = await setup.manager.dispatch({ type: 'apply' })
    let plugin = snapshot.catalog.find(entry => entry.id === 'repository-demo')
    assert.equal(plugin?.installed, true)
    assert.equal(plugin?.enabled, true)

    await setup.manager.dispatch({
      type: 'inspect',
      action: 'disable',
      pluginId: 'repository-demo',
    })
    await setup.manager.dispatch({ type: 'preview', allowBuildScripts: false })
    snapshot = await setup.manager.dispatch({ type: 'apply' })
    plugin = snapshot.catalog.find(entry => entry.id === 'repository-demo')
    assert.equal(plugin?.installed, true)
    assert.equal(plugin?.enabled, false)
    assert.doesNotMatch(
      readFileSync(join(setup.profileDir, 'cordis.patch.yml'), 'utf8'),
      /github:dsh-external\/repository-demo/,
    )

    await setup.manager.dispatch({
      type: 'inspect',
      action: 'enable',
      pluginId: 'repository-demo',
    })
    await setup.manager.dispatch({ type: 'preview', allowBuildScripts: false })
    snapshot = await setup.manager.dispatch({ type: 'apply' })
    plugin = snapshot.catalog.find(entry => entry.id === 'repository-demo')
    assert.equal(plugin?.enabled, true)
    assert.match(
      readFileSync(join(setup.profileDir, 'cordis.patch.yml'), 'utf8'),
      /github:dsh-external\/repository-demo/,
    )
  } finally {
    setup.cleanup()
  }
})
