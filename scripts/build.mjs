import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

const pluginPackages = [
  { directory: 'better-sidebar-runtime', hostOnly: true },
  { directory: 'desktop-skins', id: '@oh-dsh/desktop-skins' },
  { directory: 'desktop-sidebar', id: '@oh-dsh/desktop-sidebar' },
  { directory: 'desktop-shell', id: '@oh-dsh/desktop-shell' },
  { directory: 'panel-controls', id: '@oh-dsh/panel-controls' },
  { directory: 'pinned-summary', id: '@oh-dsh/pinned-summary' },
  { directory: 'plugin-marketplace', id: '@oh-dsh/plugin-marketplace' },
]

const shared = {
  bundle: true,
  logLevel: 'info',
  sourcemap: true,
  target: 'node24',
}

const builds = [
  build({
    ...shared,
    entryPoints: [join(root, 'src', 'main.ts')],
    outfile: join(dist, 'main.js'),
    platform: 'node',
    format: 'esm',
    external: ['electron'],
  }),
  build({
    ...shared,
    entryPoints: [join(root, 'src', 'preload.ts')],
    outfile: join(dist, 'preload.cjs'),
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  }),
  build({
    ...shared,
    entryPoints: [join(root, 'src', 'plugin.ts')],
    outfile: join(dist, 'plugin.js'),
    platform: 'node',
    format: 'esm',
  }),
]

for (const plugin of pluginPackages) {
  const source = join(root, 'plugins', plugin.directory, 'src')
  const output = join(dist, 'plugins', plugin.directory)
  const hostEntry = plugin.directory === 'better-sidebar-runtime'
    ? join(root, 'upstream', 'DSH-better-sidebar', 'src', 'index.ts')
    : join(source, 'index.ts')
  builds.push(build({
    ...shared,
    entryPoints: [hostEntry],
    outfile: join(output, 'index.js'),
    platform: 'node',
    format: 'esm',
    external: plugin.directory === 'better-sidebar-runtime'
      ? ['@deepseek-ai/*', 'cordis', 'node-pty', 'schemastery', 'ws']
      : plugin.directory === 'desktop-shell' ? ['node-pty', 'ws'] : [],
  }))
  if (plugin.hostOnly !== true) {
    builds.push(build({
      bundle: true,
      entryPoints: [join(source, 'client.ts')],
      outfile: join(output, 'client.js'),
      platform: 'browser',
      format: 'cjs',
      target: 'es2022',
      sourcemap: true,
      logLevel: 'info',
      loader: { '.css': 'text' },
      external: [
        'react',
        'react-dom/client',
        'react/jsx-runtime',
        ...(['desktop-skins', 'desktop-sidebar'].includes(plugin.directory)
          ? ['@deepseek-ai/dsh-client-runtime/client']
          : []),
      ],
      banner: {
        js: `window.__ModuleLoader__.load({ id: "${plugin.id}", factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
      },
      footer: { js: 'return module.exports; } });' },
    }))
  }
}

await Promise.all(builds)

copyFileSync(join(root, 'src', 'splash.html'), join(dist, 'splash.html'))
copyFileSync(join(root, 'cordis.patch.yml'), join(dist, 'cordis.patch.yml'))
