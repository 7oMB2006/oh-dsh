# Third-Party Notices

Oh-DSH-Desktop is distributed under the BSD 3-Clause License. The projects
below informed independently implemented bundled plugins.

Upstream UI, themes, and component styling are not bundled. Oh-DSH adapts
compatible features to its own persistence, layout, localization, and theme
contracts. The Better Sidebar Host source is tracked separately as a pinned
submodule. Upstream releases and features are reviewed regularly.

## dsh-web-panel

- Historical project: dsh-web-panel (its previous public locator is no longer available)
- Oh-DSH component: `@oh-dsh/panel-controls`

Oh-DSH adapts the Terminal dock for its desktop layout, session model, themes,
and localization. The dock uses the shared Better Sidebar PTY Host, so no
separate Web Terminal or shell plugin is required.

## DSH-better-sidebar

- Project: <https://github.com/omdsh-dev/DSH-better-sidebar>
- Pinned release: `v0.9.0`
- Pinned revision: `2e9db44a71bb75c9fa1185330541dce2582deee3`
- Declared license: MIT
- Oh-DSH components: `@oh-dsh/better-sidebar-runtime` and
  `@oh-dsh/desktop-sidebar`

Oh-DSH compiles the pinned upstream Host for PTY, bounded Files, Git status,
branch operations, history, and commit diffs. It does not load the upstream
client UI. The Oh-DSH sidebar adapts those capabilities into its own tabs,
viewers, Git Review, line comments, themes, and bilingual desktop layout. We
thank the maintainers and review upstream features regularly.

## plugin-registry and dsh-hub

- Projects: <https://github.com/vlln/plugin-registry>,
  <https://github.com/omdsh-dev/dsh-hub>, and
  <https://github.com/whyihaveyou/dsh-suite>
- Declared licenses: MIT
- Oh-DSH component: `@oh-dsh/plugin-marketplace`

Oh-DSH distills source locking, trust review, installed/enabled state,
candidate previews, updates, and recovery into one desktop transaction. Its
navigation, approval flow, and bilingual UI are implemented in this
repository.

## dsh-skins

- Historical project: dsh-skins (its previous public locator is no longer available)
- Oh-DSH component: `@oh-dsh/desktop-skins`

Oh-DSH follows the ThemeService extension model while providing original
skins, a desktop Settings interface, and Host-backed persistence.
