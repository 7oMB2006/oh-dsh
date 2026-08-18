import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const TUI_PRODUCT_NAME = 'Oh-DSH TUI'

function replaceOnce(path, before, after) {
  const source = readFileSync(path, 'utf8')
  if (source.includes(after)) return
  const first = source.indexOf(before)
  if (first === -1 || source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`TUI upstream adapter seam changed: ${path}`)
  }
  writeFileSync(path, source.slice(0, first) + after + source.slice(first + before.length))
}

function replaceEvery(path, before, after) {
  const source = readFileSync(path, 'utf8')
  if (!source.includes(before)) {
    if (source.includes(after)) return
    throw new Error(`TUI upstream adapter seam changed: ${path}`)
  }
  writeFileSync(path, source.split(before).join(after))
}

/**
 * Apply the small Oh-DSH adapter to a copied upstream package. Exact-match
 * guards make an upstream layout change fail packaging instead of silently
 * restoring a second data root or the upstream launcher identity.
 */
export function adaptTuiRendererPackage(packageDir) {
  const lib = join(packageDir, 'lib', 'types')
  const paths = join(lib, 'utils', 'paths.js')
  replaceOnce(
    paths,
    "export const DATA_DIR = join(homeDir(), '.dsh-tui');",
    "export const DATA_DIR = process.env.OH_DSH_TUI_CONFIG_HOME ?? join(homeDir(), '.ohdsh', 'tui');",
  )
  replaceOnce(
    paths,
    "export const LEGACY_DATA_DIR = join(homeDir(), '.dsh-cc');",
    'export const LEGACY_DATA_DIR = DATA_DIR;',
  )

  const logo = join(lib, 'components', 'LogoV2.js')
  replaceOnce(
    logo,
    "sweep('✦ dsh-TUI', t, wordmarkRGB, wordmarkShimmerRGB, 60)",
    "sweep(process.env.OH_DSH_TUI_TITLE ?? 'Oh-DSH TUI', t, wordmarkRGB, wordmarkShimmerRGB, 60)",
  )
  replaceOnce(
    logo,
    "'  v' + VERSION",
    "'  v' + (process.env.DSH_OH_TUI_VERSION ?? VERSION)",
  )

  const chat = join(lib, 'screens', 'Chat.js')
  replaceOnce(
    chat,
    '`${titlePrefix} 🐋 ${channel.sessionTitle}`',
    "`${titlePrefix} ${process.env.OH_DSH_TUI_TITLE ?? 'Oh-DSH TUI'} · ${channel.sessionTitle}`",
  )

  const commands = join(lib, 'commands.js')
  for (const [before, after] of [
    ['Show the dsh-tui configuration source', 'Show the Oh-DSH TUI configuration source'],
    ['Update dsh-tui and restart', 'Update Oh-DSH TUI and restart'],
    ['Practice programming with dsh-tui', 'Practice programming with Oh-DSH TUI'],
    ['Exit dsh-tui', 'Exit Oh-DSH TUI'],
  ]) {
    replaceEvery(commands, before, after)
  }

  const plugin = join(lib, 'dsh-adapter', 'plugin.js')
  replaceEvery(
    plugin,
    'dsh-tui requires an interactive terminal',
    'Oh-DSH TUI requires an interactive terminal',
  )
  replaceEvery(plugin, 'dsh-tui: exit after error:', 'Oh-DSH TUI: exit after error:')
  replaceEvery(plugin, 'dsh-tui crashed:', 'Oh-DSH TUI crashed:')
  replaceEvery(
    plugin,
    'Updating @deepseek-harness-tui/dsh-tui and restarting…',
    'Updating Oh-DSH TUI and restarting…',
  )
  replaceOnce(
    plugin,
    "const boot = profile === undefined ? 'dsh --config cordis.yml' : `dsh --profile ${profile}`;\n    return process.platform === 'win32'\n        ? `dsh-tui --resume ${sessionId}`\n        : `DSH_TUI_RESUME_SESSION=${sessionId} ${boot}`;",
    'return `ohdsh tui --resume ${sessionId}`;',
  )
  replaceEvery(plugin, 'dsh-tui --resume', 'ohdsh tui --resume')

  const channel = join(lib, 'dsh-adapter', 'channel.js')
  replaceOnce(
    channel,
    '`dsh-tui-export-${Date.now()}.md`',
    '`oh-dsh-tui-export-${Date.now()}.md`',
  )
  replaceOnce(
    channel,
    "join(userHome, '.dsh-tui/cordis.yml')",
    "join(process.env.OH_DSH_TUI_CONFIG_HOME ?? join(userHome, '.ohdsh', 'tui'), 'cordis.yml')",
  )

  const compatibility = join(lib, 'dsh-adapter', 'compat', 'sessionLog.js')
  replaceOnce(
    compatibility,
    "roots.push(join(home, '.dsh-tui', 'sessions'));",
    "roots.push(join(process.env.OH_DSH_TUI_CONFIG_HOME ?? join(home, '.ohdsh', 'tui'), 'sessions'));",
  )

  const messages = join(lib, 'i18n.js')
  replaceEvery(messages, '~/.dsh-tui', '~/.ohdsh/tui')
  replaceEvery(messages, 'dsh-tui', 'Oh-DSH TUI')

  const customTheme = join(lib, 'customTheme.js')
  replaceEvery(customTheme, '[dsh-tui]', '[Oh-DSH TUI]')
  replaceEvery(customTheme, '~/.dsh-tui', '~/.ohdsh/tui')
  const themeProvider = join(lib, 'components', 'design-system', 'ThemeProvider.js')
  replaceEvery(themeProvider, '[dsh-tui]', '[Oh-DSH TUI]')
  replaceEvery(themeProvider, '~/.dsh-tui', '~/.ohdsh/tui')
  const pluginStorage = join(lib, 'dsh-adapter', 'plugin-storage.js')
  replaceEvery(pluginStorage, '~/.dsh-tui', '~/.ohdsh/tui')
}
