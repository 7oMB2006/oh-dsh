# Third-Party Notices

Oh-DSH-Desktop is distributed under the BSD 3-Clause License. The following
project materially informed an independently implemented bundled plugin.

## DSH-better-sidebar

- Project: <https://github.com/dsh-external/DSH-better-sidebar>
- Audited revision: `a465bdee3895330c8d100c954a16363e57589333`
- Declared license: MIT
- Oh-DSH component: `@oh-dsh/desktop-sidebar`

Oh-DSH-Desktop is a downstream consumer of the project's design work around
sidebar registration lifecycles, per-session tabs, viewer selection, feature
switches, and unavailable-provider recovery. We thank the maintainers for
making those ideas available to the DSH ecosystem.

The upstream UI, themes, and component styling are not vendored. The Oh-DSH
plugin is implemented in this repository against its own service, persistence,
layout, localization, and theme contracts.
