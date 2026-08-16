import { basename } from 'node:path'

/**
 * Build-time counterpart of `tui-upstream-adapter.mjs`. The TUI marketplace
 * adapter bundles the pinned dsh-TUI source into its host plugin, so the
 * source must be adapted before esbuild compiles it. Keep each replacement
 * exact; an upstream move fails the build instead of silently rebranding a
 * different seam.
 */

function replaceOnce(source, before, after) {
  if (source.includes(after)) return source
  const first = source.indexOf(before)
  if (first === -1 || source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`TUI upstream source adapter seam changed: ${before}`)
  }
  return source.slice(0, first) + after + source.slice(first + before.length)
}

function replaceEvery(source, before, after) {
  if (!source.includes(before)) {
    if (source.includes(after)) return source
    throw new Error(`TUI upstream source adapter seam changed: ${before}`)
  }
  return source.split(before).join(after)
}

function scopePreferenceFile(source, declaration = 'PREFS_DIR') {
  return replaceOnce(
    source,
    `const ${declaration} = join(homedir(), '.dsh-cc')`,
    `const ${declaration} = process.env.OH_DSH_TUI_CONFIG_HOME ?? join(homedir(), '.ohdsh', 'tui')`,
  )
}

export function transformTuiUpstreamSource(path, source) {
  const name = basename(path)
  if (name === 'LogoV2.tsx') {
    source = replaceOnce(
      source,
      "sweep('✦ dsh-cc', t, wordmarkRGB, wordmarkShimmerRGB, 60)",
      "sweep(process.env.OH_DSH_TUI_TITLE ?? 'Oh-DSH TUI', t, wordmarkRGB, wordmarkShimmerRGB, 60)",
    )
    source = replaceOnce(
      source,
      "'  v' + VERSION",
      "'  v' + (process.env.DSH_OH_TUI_VERSION ?? VERSION)",
    )
    return source
  }
  if (name === 'Chat.tsx') {
    source = replaceOnce(
      source,
      '`${titlePrefix} 🐋 ${channel.sessionTitle}`,',
      "`${titlePrefix} ${process.env.OH_DSH_TUI_TITLE ?? 'Oh-DSH TUI'} · ${channel.sessionTitle}`,",
    )
    source = replaceOnce(
      source,
      '`${userHome}\\\\.dsh-cc\\\\cordis.yml`',
      '`${process.env.OH_DSH_TUI_CONFIG_HOME ?? `${userHome}\\\\.ohdsh\\\\tui`}\\\\cordis.yml`',
    )
    return source
  }
  if (name === 'customTheme.ts') {
    source = replaceOnce(
      source,
      "export const CUSTOM_THEME_DIR = join(homedir(), '.dsh-cc', 'themes')",
      "export const CUSTOM_THEME_DIR = join(process.env.OH_DSH_TUI_CONFIG_HOME ?? join(homedir(), '.ohdsh', 'tui'), 'themes')",
    )
    source = replaceEvery(source, '[dsh-cc-tui]', '[Oh-DSH TUI]')
    return replaceEvery(source, '~/.dsh-cc', '~/.ohdsh/tui')
  }
  if ([
    'activityPrefs.ts',
    'effortPrefs.ts',
    'modelPrefs.ts',
    'presetPrefs.ts',
    'themePrefs.ts',
  ].includes(name)) {
    return scopePreferenceFile(source)
  }
  if (name === 'i18n.ts') {
    source = scopePreferenceFile(source)
    source = replaceEvery(source, '~/.dsh-cc', '~/.ohdsh/tui')
    source = replaceEvery(source, 'dsh-cc.cmd / dsh --config <上述任一配置>', 'ohdsh tui')
    source = replaceEvery(source, 'dsh-cc.cmd / dsh --config <either config above>', 'ohdsh tui')
    return replaceEvery(source, 'dsh-cc', 'Oh-DSH TUI')
  }
  if (name === 'history.ts') {
    return scopePreferenceFile(source, 'HISTORY_DIR')
  }
  if (name === 'sessionHistory.ts') {
    return scopePreferenceFile(source, 'DIR')
  }
  if (name === 'commands.ts') {
    source = replaceOnce(
      source,
      "description: 'Show the dsh-cc configuration source'",
      "description: 'Show the Oh-DSH TUI configuration source'",
    )
    source = replaceOnce(
      source,
      "description: 'Practice programming with dsh-cc'",
      "description: 'Practice programming with Oh-DSH TUI'",
    )
    return replaceOnce(
      source,
      "description: 'Exit dsh-cc'",
      "description: 'Exit Oh-DSH TUI'",
    )
  }
  if (name === 'channel.ts') {
    source = replaceOnce(
      source,
      '`dsh-cc-export-${Date.now()}.md`',
      '`oh-dsh-tui-export-${Date.now()}.md`',
    )
    source = replaceOnce(
      source,
      "join(userHome, '.dsh-cc/cordis.yml')",
      "join(process.env.OH_DSH_TUI_CONFIG_HOME ?? join(userHome, '.ohdsh', 'tui'), 'cordis.yml')",
    )
    return replaceOnce(
      source,
      "join(userHome, '.dsh-cc/sessions')",
      "join(process.env.OH_DSH_TUI_CONFIG_HOME ?? join(userHome, '.ohdsh', 'tui'), 'sessions')",
    )
  }
  if (name === 'ThemeProvider.tsx') {
    source = replaceEvery(source, '[dsh-cc-tui]', '[Oh-DSH TUI]')
    return replaceEvery(source, '~/.dsh-cc', '~/.ohdsh/tui')
  }
  return source
}
