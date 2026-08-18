import assert from 'node:assert/strict'
import { spawn, type SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { TUI_BUNDLES, TUI_PROFILE } from '../src/profile.ts'
import { adaptTuiRendererPackage } from '../scripts/tui-upstream-adapter.mjs'
import {
  DEFAULT_TUI_HOME,
  main,
  parseTuiArgs,
  type TuiSpawner,
} from '../src/tui.ts'

function output(isTTY = false): { stream: NodeJS.WriteStream; text: () => string } {
  let value = ''
  return {
    stream: {
      isTTY,
      write: (chunk: string) => {
        value += chunk
        return true
      },
    } as unknown as NodeJS.WriteStream,
    text: () => value,
  }
}

test('TUI arguments keep environment defaults behind explicit flags', () => {
  assert.equal(DEFAULT_TUI_HOME, join(homedir(), '.ohdsh'))

  const defaults = parseTuiArgs([], {
    DSH_OH_TUI_CWD: '/env/workspace',
    DSH_OH_TUI_FULLSCREEN: '0',
    DSH_OH_TUI_HOME: '/env/home',
    DSH_OH_TUI_LANG: 'en',
    DSH_OH_TUI_PRESET: 'code',
    DSH_OH_TUI_SESSION_ID: 'session-from-env',
  }, '/default/workspace', '/default/home')
  assert.deepEqual(defaults, {
    cwd: '/env/workspace',
    dataRoot: '/env/home',
    fullscreen: false,
    help: false,
    lang: 'en',
    preset: 'code',
    sessionId: 'session-from-env',
  })

  assert.equal(
    parseTuiArgs([], { OH_DSH_HOME: '/shared/home' }).dataRoot,
    '/shared/home',
  )

  const flags = parseTuiArgs([
    '--cwd', '/flag/workspace',
    '--data=/flag/home',
    '--resume', 'session-from-flag',
    '--lang', 'zh',
    '--preset=minimal',
    '--fullscreen',
  ], {
    DSH_OH_TUI_FULLSCREEN: '0',
  }, '/default/workspace', '/default/home')
  assert.deepEqual(flags, {
    cwd: '/flag/workspace',
    dataRoot: '/flag/home',
    fullscreen: true,
    help: false,
    lang: 'zh',
    preset: 'minimal',
    sessionId: 'session-from-flag',
  })
})

test('TUI launcher initializes its profile and attaches the packaged runtime', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-tui-'))
  const packaged = join(root, 'package')
  const workspace = join(root, 'workspace')
  const dataRoot = join(root, 'data')
  const nodeBinary = process.platform === 'win32'
    ? join(packaged, 'node-runtime', 'node.exe')
    : join(packaged, 'node-runtime', 'bin', 'node')
  const cliEntry = join(packaged, 'dsh-runtime', 'lib', 'bin.js')
  mkdirSync(dirname(nodeBinary), { recursive: true })
  mkdirSync(dirname(cliEntry), { recursive: true })
  mkdirSync(workspace, { recursive: true })
  writeFileSync(nodeBinary, '')
  writeFileSync(cliEntry, '')
  writeFileSync(join(packaged, 'package.json'), '{"version":"1.2.3"}\n')

  let launch: { args: readonly string[]; command: string; options: SpawnOptions } | undefined
  const spawnTui = ((
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => {
    launch = { args, command, options }
    const child = new EventEmitter()
    queueMicrotask(() => { child.emit('exit', 0, null) })
    return child as ReturnType<typeof spawn>
  }) as TuiSpawner

  const stdout = output(true)
  const stderr = output(true)
  try {
    assert.equal(await main(
      ['--cwd', workspace, '--data', dataRoot, '--inline', '--lang', 'en'],
      { DSH_OH_TUI_ROOT: packaged, PATH: process.env.PATH },
      stdout.stream,
      stderr.stream,
      spawnTui,
      { isTTY: true } as Readable & { isTTY?: boolean },
    ), 0)
    assert.ok(launch)
    assert.equal(launch.command, nodeBinary)
    assert.deepEqual(launch.args, [cliEntry, '--profile', TUI_PROFILE])
    assert.equal(launch.options.cwd, workspace)
    assert.equal(launch.options.stdio, 'inherit')
    const childEnv = launch.options.env
    assert.equal(childEnv?.DSH_HOME, dataRoot)
    assert.equal(childEnv?.OH_DSH_HOME, dataRoot)
    assert.equal(childEnv?.OH_DSH_TUI_FULLSCREEN, '0')
    assert.equal(childEnv?.OH_DSH_TUI_LANG, 'en')
    assert.equal(childEnv?.DSH_OH_TUI_VERSION, '1.2.3')
    assert.equal(childEnv?.OH_DSH_TUI_CONFIG_HOME, join(dataRoot, 'tui'))
    assert.equal(childEnv?.OH_DSH_TUI_TITLE, 'Oh-DSH TUI')

    const manifest = JSON.parse(readFileSync(
      join(dataRoot, 'profiles', TUI_PROFILE, 'package.json'),
      'utf8',
    ))
    assert.equal(manifest.name, 'dsh-profile-tui')
    assert.deepEqual(manifest.dsh.profile.bundles, TUI_BUNDLES)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('TUI bundle mounts Oh-DSH adapters before the upstream renderer', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const patch = readFileSync(
    join(root, 'plugins', 'tui', 'cordis.patch.yml'),
    'utf8',
  ).replace(/\r\n?/g, '\n')
  assert.match(patch, /- id: cc-tui\n  disabled: true/)
  assert.match(patch, /- id: dsh-tui\n  disabled: true/)
  const surface = patch.indexOf("name: '@oh-dsh/tui'")
  const marketplace = patch.indexOf("name: '@oh-dsh/plugin-marketplace'")
  const skins = patch.indexOf("name: '@oh-dsh/skins'")
  const vision = patch.indexOf("name: '@oh-dsh/vision'")
  const marketplaceScene = patch.indexOf("name: '@oh-dsh/tui-marketplace'")
  const renderer = patch.indexOf("name: '@deepseek-harness-tui/dsh-tui'")
  assert.ok(surface >= 0
    && surface < marketplace
    && marketplace < skins
    && skins < vision
    && vision < marketplaceScene
    && marketplaceScene < renderer)
})

test('TUI upstream adapter removes legacy terminal branding and scopes storage', () => {
  const root = mkdtempSync(join(tmpdir(), 'oh-dsh-tui-adapter-'))
  const repository = join(dirname(fileURLToPath(import.meta.url)), '..')
  const lib = join(root, 'lib', 'types')
  cpSync(join(repository, 'upstream', 'dsh-TUI', 'lib', 'types'), lib, {
    recursive: true,
  })
  try {
    adaptTuiRendererPackage(root)
    const paths = readFileSync(join(lib, 'utils', 'paths.js'), 'utf8')
    assert.match(paths, /OH_DSH_TUI_CONFIG_HOME/)
    assert.match(paths, /LEGACY_DATA_DIR = DATA_DIR/)
    assert.doesNotMatch(paths, /join\(homeDir\(\), '\.dsh-(?:tui|cc)'\)/)
    assert.match(readFileSync(join(lib, 'components', 'LogoV2.js'), 'utf8'), /Oh-DSH TUI/)
    assert.match(readFileSync(join(lib, 'components', 'LogoV2.js'), 'utf8'), /DSH_OH_TUI_VERSION/)
    assert.match(readFileSync(join(lib, 'screens', 'Chat.js'), 'utf8'), /Oh-DSH TUI/)
    const commands = readFileSync(join(lib, 'commands.js'), 'utf8')
    assert.match(commands, /Exit Oh-DSH TUI/)
    assert.doesNotMatch(commands, /description: .*dsh-tui/)
    const plugin = readFileSync(join(lib, 'dsh-adapter', 'plugin.js'), 'utf8')
    assert.match(plugin, /ohdsh tui --resume/)
    assert.doesNotMatch(plugin, /dsh-tui --resume/)
    const messages = readFileSync(join(lib, 'i18n.js'), 'utf8')
    assert.match(messages, /~\/\.ohdsh\/tui/)
    assert.doesNotMatch(messages, /dsh-tui|~\/\.dsh-tui/)
    const channel = readFileSync(join(lib, 'dsh-adapter', 'channel.js'), 'utf8')
    assert.match(channel, /oh-dsh-tui-export-/)
    assert.doesNotMatch(
      channel,
      /const fileName = `dsh-tui-export-|join\(userHome, '\.dsh-tui\//,
    )
    const compatibility = readFileSync(
      join(lib, 'dsh-adapter', 'compat', 'sessionLog.js'),
      'utf8',
    )
    assert.match(compatibility, /OH_DSH_TUI_CONFIG_HOME/)
    const themeProvider = readFileSync(
      join(lib, 'components', 'design-system', 'ThemeProvider.js'),
      'utf8',
    )
    assert.doesNotMatch(themeProvider, /\[dsh-tui\]|~\/\.dsh-tui/)
    const customTheme = readFileSync(join(lib, 'customTheme.js'), 'utf8')
    assert.doesNotMatch(customTheme, /\[dsh-tui\]|~\/\.dsh-tui/)
    const pluginStorage = readFileSync(join(lib, 'dsh-adapter', 'plugin-storage.js'), 'utf8')
    assert.doesNotMatch(pluginStorage, /~\/\.dsh-tui/)
    assert.doesNotThrow(() => { adaptTuiRendererPackage(root) })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('TUI refuses a non-interactive stream before touching the runtime', async () => {
  const stdout = output(false)
  const stderr = output(false)
  assert.equal(await main(
    [],
    {},
    stdout.stream,
    stderr.stream,
    undefined,
    { isTTY: false } as Readable & { isTTY?: boolean },
  ), 2)
  assert.match(stderr.text(), /requires an interactive terminal/)
})

test('TUI help is available without a terminal or staged runtime', async () => {
  const stdout = output(false)
  assert.equal(await main(['--help'], {}, stdout.stream), 0)
  assert.match(stdout.text(), /ohdsh tui/)
  assert.match(stdout.text(), /--resume/)
})
