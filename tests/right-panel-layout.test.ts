import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('embedded tools keep the application root inside the window row', () => {
  const css = readFileSync(
    join(root, 'plugins/desktop-sidebar/src/client/desktop-sidebar.css'),
    'utf8',
  )

  assert.match(
    css,
    /#oh-dsh-embedded-layout\s*\{[^}]*grid-template-rows: minmax\(0, 1fr\);/s,
  )
  assert.match(
    css,
    /#oh-dsh-embedded-layout > #root\s*\{[^}]*min-height: 0;[^}]*overflow: hidden;/s,
  )
})

test('review, pinned summary, and embedded side tools keep distinct layouts', () => {
  const summary = readFileSync(join(root, 'plugins/pinned-summary/src/client.ts'), 'utf8')
  const workspace = readFileSync(join(root, 'plugins/desktop-sidebar/src/client/plugin.tsx'), 'utf8')
  const workspaceCss = readFileSync(join(root, 'plugins/desktop-sidebar/src/client/desktop-sidebar.css'), 'utf8')
  const sideTools = readFileSync(join(root, 'plugins/desktop-sidebar/src/client/SideToolsPanel.tsx'), 'utf8')
  const sideToolsCss = readFileSync(join(root, 'plugins/desktop-sidebar/src/client/side-tools.css'), 'utf8')

  assert.match(workspace, /if \(open\) this\.pinnedSummary\.setOpen\(false\)/)
  assert.match(workspace, /if \(this\.state\.open\) this\.pinnedSummary\.setOpen\(false\)/)
  assert.match(workspace, /ohDshRightPanelOwner = 'desktop-sidebar'/)
  assert.match(summary, /ohDshRightPanelOwner = 'pinned-summary'/)
  assert.match(summary, /calc\(var\(--oh-dsh-pinned-summary-width\) \+ 24px\)/)
  assert.match(summary, /height: calc\(\(100vh - var\(--oh-dsh-titlebar-height, 40px\) - 24px\) \/ 2\);/)
  assert.doesNotMatch(summary, /height: min\(360px/)
  assert.doesNotMatch(workspace, /aria-label="Toggle review panel"/)
  assert.match(workspace, /className="oh-dsh-review-view"/)
  assert.doesNotMatch(workspace, /oh-dsh-review-panel/)
  assert.doesNotMatch(workspace, /const embeddedWidth/)
  assert.match(workspace, /const track = this\.state\.open && !this\.narrowViewport\.matches \? this\.state\.width : 0/)
  assert.match(workspaceCss, /\.oh-dsh-review-view\s*\{[^}]*display: flex;[^}]*flex: 1;[^}]*flex-direction: column;/s)
  assert.match(sideTools, /props\.sidebar\.getTabs\(\)/)
  assert.match(sideTools, /props\.sidebar\.getTab\(activeTab\.type\)/)
  assert.match(sideTools, /descriptor\.render\(renderProps\)/)
  assert.match(sideTools, /<TabStrip sidebar=\{props\.sidebar\} t=\{props\.t\} \/>/)
  assert.match(workspace, /function registerBuiltinSidebarTools/)
  assert.match(workspace, /sidebar\.registerTab\(\{[\s\S]*id: 'review'/)
  assert.match(workspace, /sidebar\.registerViewer\(\{[\s\S]*id: 'binary'/)
  assert.match(workspace, /desktopSidebar\.setSession\(sessions\.list\.getSnapshot\(\)\.current \?\? null\)/)
  assert.match(sideToolsCss, /\.oh-dsh-side-panel\s*\{[^}]*width: 100% !important;[^}]*border-radius: 0;[^}]*box-shadow: none;/s)
  assert.match(workspace, /const sideOpen = workspaceState\.open/)
  assert.match(workspace, /\{sideOpen\s*\?\s*\(/)
  assert.doesNotMatch(workspace, /\{workspaceState\.open\s*\?\s*\(/)
  assert.match(workspace, /service\.setOpen\(false\); pinnedSummary\.toggle\(\)/)
  assert.match(workspace, /kind === 'summary'[\s\S]{0,200}M9 5h7M4 10h12/)
  assert.match(workspaceCss, /\.oh-dsh-workspace-panel\[data-open='true'\]/)
  assert.match(summary, /\[data-oh-dsh-pinned-summary\]\[data-open='true'\]/)
})
