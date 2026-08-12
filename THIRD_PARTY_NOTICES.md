# Third-Party Notices

Oh-DSH-Desktop is distributed under the BSD 3-Clause License. The projects
below informed independently implemented bundled plugins.

Upstream UI, themes, and component styling are not vendored. Oh-DSH adapts
compatible features to its own service, persistence, layout, localization,
and theme contracts. Upstream releases and features are reviewed regularly.

## dsh-web-panel

- Project: <https://github.com/dsh-external/dsh-web-panel>
- Declared license: BSD 3-Clause
- Oh-DSH component: `@oh-dsh/panel-controls`

Oh-DSH rewrites the PTY host and Terminal dock for its desktop layout,
session model, themes, and localization. No separate Web Terminal plugin is
required.

## DSH-better-sidebar

- Project: <https://github.com/dsh-external/DSH-better-sidebar>
- Audited revision: `a465bdee3895330c8d100c954a16363e57589333`
- Declared license: MIT
- Oh-DSH component: `@oh-dsh/desktop-sidebar`

Oh-DSH-Desktop is a downstream consumer of the project's design work around
sidebar registration lifecycles, per-session tabs, viewer selection, feature
switches, and unavailable-provider recovery. We thank the maintainers for
making those ideas available to the DSH ecosystem.

## plugin-registry and dsh-hub

- Projects: <https://github.com/dsh-external/plugin-registry> and
  <https://github.com/dsh-external/dsh-hub>
- Declared licenses: BSD 3-Clause and MIT
- Oh-DSH component: `@oh-dsh/plugin-marketplace`

Oh-DSH distills source locking, trust review, installed/enabled state,
candidate previews, updates, and recovery into one desktop transaction. Its
navigation, approval flow, and bilingual UI are implemented in this
repository.

## dsh-skins

- Project: <https://github.com/dsh-external/dsh-skins>
- Declared license: MIT
- Oh-DSH component: `@oh-dsh/desktop-skins`

Oh-DSH follows the ThemeService extension model while providing original
skins, a desktop Settings interface, and Host-backed persistence.
