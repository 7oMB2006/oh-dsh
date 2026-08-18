import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ALLOWLIST = [
  'agent-loop',
  'shell',
  'locale',
  'permission',
  'ui-conversation',
  'ui-theme',
  'web-search-deepseek',
  'ui-onboarding',
  'settings',
  'oh-dsh-vision',
]

const CONSTANT = [
  '\n/**',
  ' * Downstream configuration-client boundary restored for the pinned rc.7',
  ' * release: settings.describe filters and every settings write refuse',
  ' * namespaces outside this allowlist with `settings-not-exposed`.',
  ' * Model-provider namespaces remain exposed.',
  ' */',
  'const WEB_SETTINGS_NAMESPACES = new Set([',
  ...ALLOWLIST.map(namespace => `\t"${namespace}",`),
  ']);\n',
].join('\n')

const DESCRIBE_ANCHOR =
  'namespaces: settings.describe({ redactSecrets: true }).map(namespaceView)'
const DESCRIBE_REPLACEMENT = [
  'namespaces: settings.describe({ redactSecrets: true }).filter((descriptor) => {',
  '\t\t\t\t\tif (WEB_SETTINGS_NAMESPACES.has(String(descriptor.ns))) return true',
  '\t\t\t\t\tfor (const entry of ctx.llm.listConfigurableProviders()) {',
  '\t\t\t\t\t\tif (entry.settingsNs === String(descriptor.ns)) return true',
  '\t\t\t\t\t}',
  '\t\t\t\t\treturn false',
  '\t\t\t\t}).map(namespaceView)',
].join('\n')
const WRITE_ANCHOR = 'branded = settingsNamespace(ns);'
const WRITE_GUARD = [
  '\t\tif (WEB_SETTINGS_NAMESPACES.has(ns) === false && ctx.llm.listConfigurableProviders().every((entry) => entry.settingsNs !== ns)) {',
  '\t\t\treturn err(request, {',
  '\t\t\t\tcode: "settings-not-exposed",',
  '\t\t\t\tmessage: `settings namespace "${ns}" is not exposed to configuration clients`,',
  '\t\t\t\tdetails: { ns },',
  '\t\t\t})',
  '\t\t}',
].join('\n')
const CONSTANT_ANCHOR = 'const DEFAULT_MAX_MESSAGES = 50;'

function apiProxyIndex(runtimeRoot) {
  const store = join(runtimeRoot, 'node_modules', '.pnpm')
  if (existsSync(store)) {
    const entry = readdirSync(store, { withFileTypes: true })
      .find(candidate => candidate.isDirectory()
        && candidate.name.startsWith('@deepseek-ai+dsh-host-apiproxy@'))
    if (entry !== undefined) {
      return join(
        store,
        entry.name,
        'node_modules',
        '@deepseek-ai',
        'dsh-host-apiproxy',
        'lib',
        'index.js',
      )
    }
  }

  // Windows release staging uses pnpm's hoisted linker, which exposes
  // packages directly under node_modules instead of .pnpm.
  const hoisted = join(
    runtimeRoot,
    'node_modules',
    '@deepseek-ai',
    'dsh-host-apiproxy',
    'lib',
    'index.js',
  )
  if (existsSync(hoisted)) return hoisted

  throw new Error('dsh-host-apiproxy is missing from the staged runtime')
}

/**
 * Restore Oh-DSH's configuration-client boundary in an assembled rc.7
 * runtime. Both regular staging and Nix assembly call this function.
 */
export function restoreSettingsBoundary(runtimeRoot) {
  const indexPath = apiProxyIndex(runtimeRoot)
  const source = readFileSync(indexPath, 'utf8')
  if (source.includes(CONSTANT)) {
    console.log('Settings namespace boundary already restored')
    return
  }
  if (source.includes('WEB_SETTINGS_NAMESPACES')) {
    throw new Error(
      'dsh-host-apiproxy settings boundary has an unexpected shape; review needed',
    )
  }
  for (const anchor of [CONSTANT_ANCHOR, DESCRIBE_ANCHOR, WRITE_ANCHOR]) {
    if (source.includes(anchor) === false) {
      throw new Error(`dsh-host-apiproxy settings boundary anchor missing: ${anchor}`)
    }
  }
  let next = source.replace(CONSTANT_ANCHOR, CONSTANT_ANCHOR + CONSTANT)
  next = next.replace(DESCRIBE_ANCHOR, DESCRIBE_REPLACEMENT)
  next = next.replace(WRITE_ANCHOR, WRITE_ANCHOR + '\n' + WRITE_GUARD)
  writeFileSync(indexPath, next)
  console.log('Restored the settings namespace boundary on the staged api-proxy')
}

const invokedPath = process.argv[1] === undefined
  ? null
  : pathToFileURL(resolve(process.argv[1])).href
if (invokedPath === import.meta.url) {
  const runtimeRoot = process.argv[2]
  if (runtimeRoot === undefined || process.argv.length !== 3) {
    throw new Error('usage: node scripts/settings-boundary.mjs <runtime-root>')
  }
  restoreSettingsBoundary(resolve(runtimeRoot))
}
