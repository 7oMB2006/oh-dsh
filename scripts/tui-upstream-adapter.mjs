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

function scopePreferenceFile(lib, name, declaration = 'PREFS_DIR') {
  replaceOnce(
    join(lib, name),
    `const ${declaration} = join(homedir(), '.dsh-cc');`,
    `const ${declaration} = process.env.OH_DSH_TUI_CONFIG_HOME ?? join(homedir(), '.ohdsh', 'tui');`,
  )
}

/**
 * Apply the deliberately small Oh-DSH adapter to a copied upstream package.
 * The submodule remains pristine; exact-match guards fail the build when an
 * upstream update moves a seam that needs a fresh review.
 */
export function adaptTuiRendererPackage(packageDir) {
  const lib = join(packageDir, 'lib', 'types')
  replaceOnce(
    join(lib, 'components', 'LogoV2.js'),
    "sweep('✦ dsh-cc', t, wordmarkRGB, wordmarkShimmerRGB, 60)",
    "sweep(process.env.OH_DSH_TUI_TITLE ?? 'Oh-DSH TUI', t, wordmarkRGB, wordmarkShimmerRGB, 60)",
  )
  replaceOnce(
    join(lib, 'components', 'LogoV2.js'),
    "'  v' + VERSION",
    "'  v' + (process.env.DSH_OH_TUI_VERSION ?? VERSION)",
  )
  replaceOnce(
    join(lib, 'screens', 'Chat.js'),
    'useTerminalTitle(`${titlePrefix} 🐋 ${channel.sessionTitle}`);',
    "useTerminalTitle(`${titlePrefix} ${process.env.OH_DSH_TUI_TITLE ?? 'Oh-DSH TUI'} · ${channel.sessionTitle}`);",
  )
  replaceOnce(
    join(lib, 'customTheme.js'),
    "export const CUSTOM_THEME_DIR = join(homedir(), '.dsh-cc', 'themes');",
    "export const CUSTOM_THEME_DIR = join(process.env.OH_DSH_TUI_CONFIG_HOME ?? join(homedir(), '.ohdsh', 'tui'), 'themes');",
  )
  for (const name of [
    'activityPrefs.js',
    'effortPrefs.js',
    'i18n.js',
    'modelPrefs.js',
    'presetPrefs.js',
    'themePrefs.js',
  ]) {
    scopePreferenceFile(lib, name)
  }
  scopePreferenceFile(lib, 'history.js', 'HISTORY_DIR')
  scopePreferenceFile(lib, 'sessionHistory.js', 'DIR')

  const commands = join(lib, 'commands.js')
  replaceOnce(
    commands,
    "description: 'Show the dsh-cc configuration source'",
    "description: 'Show the Oh-DSH TUI configuration source'",
  )
  replaceOnce(
    commands,
    "description: 'Practice programming with dsh-cc'",
    "description: 'Practice programming with Oh-DSH TUI'",
  )
  replaceOnce(
    commands,
    "description: 'Exit dsh-cc'",
    "description: 'Exit Oh-DSH TUI'",
  )

  const plugin = join(lib, 'plugin.js')
  replaceEvery(plugin, 'dsh-cc --resume', 'ohdsh tui --resume')
  replaceOnce(plugin, 'Resume with -c (or command below):', 'Resume with:')
  replaceEvery(
    plugin,
    'cc-tui requires an interactive terminal',
    'Oh-DSH TUI requires an interactive terminal',
  )
  replaceEvery(
    plugin,
    'cc-tui: exit after error:',
    'Oh-DSH TUI: exit after error:',
  )
  replaceEvery(plugin, 'cc-tui crashed:', 'Oh-DSH TUI crashed:')

  const messages = join(lib, 'i18n.js')
  replaceEvery(messages, '~/.dsh-cc', '~/.ohdsh/tui')
  replaceEvery(messages, 'dsh-cc.cmd / dsh --config <上述任一配置>', 'ohdsh tui')
  replaceEvery(messages, 'dsh-cc.cmd / dsh --config <either config above>', 'ohdsh tui')
  replaceEvery(messages, 'dsh-cc', 'Oh-DSH TUI')

  const channel = join(lib, 'channel.js')
  replaceOnce(
    channel,
    '`dsh-cc-export-${Date.now()}.md`',
    '`oh-dsh-tui-export-${Date.now()}.md`',
  )
  replaceOnce(
    channel,
    "join(userHome, '.dsh-cc/cordis.yml')",
    "join(process.env.OH_DSH_TUI_CONFIG_HOME ?? join(userHome, '.ohdsh', 'tui'), 'cordis.yml')",
  )
  replaceOnce(
    channel,
    "join(userHome, '.dsh-cc/sessions')",
    "join(process.env.OH_DSH_TUI_CONFIG_HOME ?? join(userHome, '.ohdsh', 'tui'), 'sessions')",
  )

  replaceOnce(
    join(lib, 'screens', 'Chat.js'),
    '`${userHome}\\\\.dsh-cc\\\\cordis.yml`',
    '`${process.env.OH_DSH_TUI_CONFIG_HOME ?? `${userHome}\\\\.ohdsh\\\\tui`}\\\\cordis.yml`',
  )

  const customTheme = join(lib, 'customTheme.js')
  replaceEvery(customTheme, '[dsh-cc-tui]', '[Oh-DSH TUI]')
  replaceEvery(customTheme, '~/.dsh-cc', '~/.ohdsh/tui')
  const themeProvider = join(lib, 'components', 'design-system', 'ThemeProvider.js')
  replaceEvery(themeProvider, '[dsh-cc-tui]', '[Oh-DSH TUI]')
  replaceEvery(themeProvider, '~/.dsh-cc', '~/.ohdsh/tui')
}
