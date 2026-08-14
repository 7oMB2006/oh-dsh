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
    "export const CUSTOM_THEME_DIR = join(process.env.OH_DSH_TUI_CONFIG_HOME ?? join(homedir(), '.dsh-cc'), 'themes');",
  )
  replaceOnce(
    join(lib, 'themePrefs.js'),
    "const PREFS_DIR = join(homedir(), '.dsh-cc');",
    "const PREFS_DIR = process.env.OH_DSH_TUI_CONFIG_HOME ?? join(homedir(), '.dsh-cc');",
  )
}
