import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('desktop win32 windows collapse title bar, menu bar, and strip into one row', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
  const contracts = readFileSync(new URL('../src/contracts.ts', import.meta.url), 'utf8')

  // The native title-bar and menu-bar rows are traded for the window-controls
  // overlay; the in-page strip owns the single merged row.
  assert.match(
    main,
    /: process\.platform === 'win32'[\s\S]*?autoHideMenuBar: true,[\s\S]*?titleBarStyle: 'hidden' as const,[\s\S]*?titleBarOverlay: titleBarOverlayOptions\(\),[\s\S]*?: \{\}\)/,
  )
  // macOS keeps the hiddenInset row and every other platform keeps the frame.
  assert.match(main, /process\.platform === 'darwin'[\s\S]*?titleBarStyle: 'hiddenInset'/)

  // Overlay geometry derives from the strip height shared across processes.
  assert.match(contracts, /export const DESKTOP_TITLEBAR_HEIGHT = 40/)
  assert.match(main, /Math\.ceil\(DESKTOP_TITLEBAR_HEIGHT \* DEFAULT_UI_ZOOM_FACTOR\)/)

  // The strip follows the overlay height and keeps its drag region.
  assert.match(client, /padding-top: env\(titlebar-area-height, var\(--oh-dsh-titlebar-height\)\)/)
  assert.match(client, /height: env\(titlebar-area-height, var\(--oh-dsh-titlebar-height\)\)/)
  assert.match(client, /-webkit-app-region: drag/)

  // The panel toolbar shifts clear of the overlay caption buttons.
  assert.match(
    client,
    /right: calc\(100vw - env\(titlebar-area-x, 0px\) - env\(titlebar-area-width, 100vw\) \+ 14px\)/,
  )
})

test('desktop win32 menu bar renders in the merged row but pops the native menu', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
  const contracts = readFileSync(new URL('../src/contracts.ts', import.meta.url), 'utf8')
  const preload = readFileSync(new URL('../src/preload.ts', import.meta.url), 'utf8')

  // The bridge exposes the application menu's labels and a native popup.
  assert.match(contracts, /menuBarLabels\(\): Promise<string\[\]\>/)
  assert.match(contracts, /popupMenuBarMenu\(index: number, cssX: number, cssY: number\): Promise<void>/)
  assert.match(preload, /desktop:menu-bar-labels/)
  assert.match(preload, /desktop:menu-bar-popup/)

  // The main process serves labels and pops the built application menu's own
  // submenus — no second menu definition beside buildMenu().
  assert.match(main, /applicationMenu = Menu\.buildFromTemplate\(template\)/)
  assert.match(main, /Menu\.setApplicationMenu\(applicationMenu\)/)
  assert.match(main, /'desktop:menu-bar-labels'/)
  assert.match(main, /submenu\.popup\(\{/)
  // CSS pixels convert to screen DIPs through the webContents zoom factor.
  assert.match(main, /cssX \* scale/)
  assert.match(main, /getZoomFactor\(\)/)

  // The client mounts the bar only for the win32 main window; buttons are
  // no-drag islands inside the draggable strip.
  assert.match(client, /info\.preview === null[\s\S]*?info\.platform === 'win32'[\s\S]*?installMenuBar\(bridge, t\)/)
  assert.match(client, /\.oh-dsh-menubar \{[\s\S]*?-webkit-app-region: drag;/)
  assert.match(client, /\.oh-dsh-menubar button \{[\s\S]*?-webkit-app-region: no-drag;/)
  assert.match(client, /popupMenuBarMenu\(index, rect\.left, rect\.bottom\)/)
})
