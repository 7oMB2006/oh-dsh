import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('desktop win32 windows collapse title bar, menu bar, and strip into one row', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
  const contracts = readFileSync(new URL('../src/contracts.ts', import.meta.url), 'utf8')

  // Windows uses a frameless native window; the renderer owns the single
  // chrome row and Electron still owns the BrowserWindow lifecycle.
  assert.match(
    main,
    /: process\.platform === 'win32'[\s\S]*?autoHideMenuBar: true, frame: false[\s\S]*?: \{\}\)/,
  )
  // macOS keeps the hiddenInset row and every other platform keeps the frame.
  assert.match(main, /process\.platform === 'darwin'[\s\S]*?titleBarStyle: 'hiddenInset'/)

  assert.match(contracts, /export const DESKTOP_TITLEBAR_HEIGHT = 40/)

  // The custom strip owns the drag region and its full row height.
  assert.match(client, /padding-top: var\(--oh-dsh-titlebar-height\)/)
  assert.match(client, /height: var\(--oh-dsh-titlebar-height\)/)
  assert.match(client, /-webkit-app-region: drag/)
  assert.match(client, /\.oh-dsh-window-actions \{[\s\S]*?height: var\(--oh-dsh-titlebar-height\)/)
  assert.match(client, /body\[data-ds-dark-theme\] \.oh-dsh-menubar-brand img[\s\S]*?filter: brightness\(0\) invert\(1\)/)
  assert.match(client, /body::before \{[\s\S]*?z-index: 2147483645[\s\S]*?pointer-events: none/)
  assert.match(client, /\.oh-dsh-menubar \{[\s\S]*?z-index: 2147483646/)
  assert.match(client, /\.oh-dsh-panel-toolbar \{[\s\S]*?z-index: 2147483647[\s\S]*?right: 154px[\s\S]*?-webkit-app-region: no-drag/)
  assert.match(client, /button\[data-action='minimize'\]::before \{[\s\S]*?top: 50%;[\s\S]*?width: 10px[\s\S]*?border-top: 1\.7px solid currentColor/)
  assert.match(client, /button\[data-action='maximize'\]::before \{[\s\S]*?width: 10px[\s\S]*?height: 10px[\s\S]*?border: 1\.7px solid currentColor/)
  assert.match(client, /button\[data-action='maximize'\]::before \{[\s\S]*?border-radius: 2px/)
  assert.match(client, /button\[data-action='maximize'\]\[data-maximized='true'\]::before[\s\S]*?width: 8px[\s\S]*?height: 8px[\s\S]*?border: 1\.7px solid currentColor/)
  assert.match(client, /button\[data-action='maximize'\]\[data-maximized='true'\]::after[\s\S]*?display: block[\s\S]*?width: 8px[\s\S]*?height: 8px/)
  assert.match(client, /button\[data-action='close'\]::before,[\s\S]*?left: 18px[\s\S]*?width: 10px/)
})

test('desktop win32 menu bar renders in the merged row but pops the native menu', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
  const contracts = readFileSync(new URL('../src/contracts.ts', import.meta.url), 'utf8')
  const preload = readFileSync(new URL('../src/preload.ts', import.meta.url), 'utf8')

  // The bridge exposes the application menu's labels and a native popup.
  assert.match(contracts, /menuBarLabels\(\): Promise<string\[\]\>/)
  assert.match(contracts, /setMenuLocale\(locale: 'en' \| 'zh'\): Promise<string\[\]\>/)
  assert.match(contracts, /popupMenuBarMenu\(index: number, cssX: number, cssY: number\): Promise<void>/)
  assert.match(preload, /desktop:menu-bar-labels/)
  assert.match(preload, /desktop:set-menu-locale/)
  assert.match(preload, /desktop:menu-bar-popup/)
  assert.match(preload, /desktop:window-close/)
  assert.match(preload, /desktop:window-toggle-maximize/)
  assert.match(preload, /desktop:window-state/)

  // The main process serves labels and pops the built application menu's own
  // submenus — no second menu definition beside buildMenu().
  assert.match(main, /applicationMenu = Menu\.buildFromTemplate\(template\)/)
  assert.match(main, /Menu\.setApplicationMenu\(applicationMenu\)/)
  assert.match(main, /'desktop:menu-bar-labels'/)
  assert.match(main, /'desktop:set-menu-locale'/)
  assert.match(main, /'desktop:window-state'/)
  assert.match(main, /window\.on\('maximize', sendWindowState\)/)
  assert.match(main, /window\.on\('unmaximize', sendWindowState\)/)
  assert.match(main, /buildMenu\(raw\)/)
  assert.match(main, /file: '文件'/)
  assert.match(main, /file: 'File'/)
  assert.match(main, /submenu\.popup\(\{/)
  assert.match(main, /function windowForSender\(event: IpcMainInvokeEvent\)/)
  assert.match(main, /windowForSender\(event\)\?\.close\(\)/)
  // CSS pixels convert to screen DIPs through the webContents zoom factor.
  assert.match(main, /cssX \* scale/)
  assert.match(main, /getZoomFactor\(\)/)

  // Every win32 window gets controls; only the main window gets the menu.
  assert.match(client, /if \(info\.platform === 'win32'\) removeMenuBar = installMenuBar\(bridge, locale, t, info\.preview === null\)/)
  assert.match(client, /if \(!includeMenu\) return/)
  assert.match(client, /setMenuLocale\(locale\.getSnapshot\(\)\.active\)/)
  assert.match(client, /const unsubscribeLocale = locale\.subscribe\(refreshMenuBar\)/)
  assert.match(client, /const unsubscribeWindowState = bridge\.onWindowState\(/)
  assert.match(client, /unsubscribeWindowState\(\)/)
  assert.match(client, /\.oh-dsh-menubar \{[\s\S]*?-webkit-app-region: no-drag;/)
  assert.match(client, /\.oh-dsh-menubar::before \{[\s\S]*?right: 270px[\s\S]*?-webkit-app-region: drag;/)
  assert.match(client, /\.oh-dsh-menubar button \{[\s\S]*?-webkit-app-region: no-drag;/)
  assert.match(client, /popupMenuBarMenu\(index, rect\.left, rect\.bottom\)/)
})
test('desktop v21 uses a replacement root frame without the v20 collapse workaround', () => {
  const packageManifest = readFileSync(new URL('../plugins/desktop-frame/package.json', import.meta.url), 'utf8')
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const profile = readFileSync(new URL('../src/profile.ts', import.meta.url), 'utf8')
  const build = readFileSync(new URL('../scripts/build.mjs', import.meta.url), 'utf8')
  const stage = readFileSync(new URL('../scripts/stage-dsh.mjs', import.meta.url), 'utf8')
  const frame = readFileSync(new URL('../plugins/desktop-frame/src/client/plugin.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../plugins/desktop-frame/src/client/frame.css', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
  const buildDsh = readFileSync(new URL('../scripts/build-dsh.mjs', import.meta.url), 'utf8')

  assert.match(packageManifest, /@oh-dsh\/desktop-frame/)
  assert.match(patch, /ui-layout[\s\S]*?disabled: true/)
  assert.match(patch, /oh-desktop-frame[\s\S]*?@oh-dsh\/desktop-frame/)
  assert.match(profile, /@oh-dsh\/desktop-frame/)
  assert.match(build, /directory: 'desktop-frame', id: '@oh-dsh\/desktop-frame'/)
  assert.match(stage, /desktop-frame/)
  assert.match(frame, /name: 'root'/)
  assert.match(frame, /sidebar: \{ kind: 'single', scope: 'root' \}/)
  assert.match(frame, /conversation: \{ kind: 'single', scope: 'session-maybe' \}/)
  assert.match(frame, /details: \{ kind: 'single', scope: 'session' \}/)
  assert.match(frame, /'shell\.overlay': \{ kind: 'list', scope: 'root' \}/)
  assert.match(frame, /gridTemplateColumns/)
  assert.match(css, /grid-template-columns var\(--ds-transition-duration-slow\) var\(--ds-ease-in-out\)/)
  assert.match(frame, /const lastSession = useRef\(detailsSession\)/)
  assert.match(frame, /lastSession\.current !== detailsSession[\s\S]*?actions\.closeDetails\(\)/)
  assert.match(frame, /let frame: number \| null = null/)
  assert.match(frame, /requestAnimationFrame\(\(\) => \{/)
  assert.match(frame, /data-shell-overlay/)
  assert.doesNotMatch(client, /installSidebarCollapseEdge|oh-dsh-sidebar-collapse-edge|data-sidebar-collapsed\] \{ transition: none/)
  assert.doesNotMatch(buildDsh, /withImmediateSidebarRail|COLLAPSE_SETTLE_MS|rail animation patch/)
})
