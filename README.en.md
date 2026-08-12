<p align="center">
  <a href="./README.md">简体中文</a> ·
  <strong>English</strong>
</p>

<div align="center">
  <img src="./assets/dsh-whale.png" width="160" alt="Oh-DSH-Desktop whale">
  <h1>Oh-DSH-Desktop</h1>
  <p><strong>DeepSeek Harness, packaged as an installable and extensible desktop workbench.</strong></p>
  <p>
    <a href="#installation">Installation</a> ·
    <a href="#architecture">Architecture</a> ·
    <a href="#bundled-plugins">Bundled Plugins</a> ·
    <a href="#local-build-and-release">Build and Release</a>
  </p>
</div>

<p align="center">
  <img alt="macOS 12+" src="https://img.shields.io/badge/macOS-12%2B-111111?logo=apple&logoColor=white">
  <img alt="Apple Silicon" src="https://img.shields.io/badge/arch-arm64-2f81f7">
  <img alt="DSH 0.0.1-rc.1" src="https://img.shields.io/badge/DSH-0.0.1--rc.1-2f81f7">
  <img alt="Electron 42" src="https://img.shields.io/badge/Electron-42-47848f?logo=electron&logoColor=white">
  <img alt="BSD 3-Clause" src="https://img.shields.io/badge/license-BSD--3--Clause-34a853">
</p>

<p align="center">
  <img src="./assets/oh-dsh-desktop-overview.png" alt="Oh-DSH-Desktop main interface and Side Panel" width="100%">
  <br>
  <sub>Main interface, Side Panel, and the Porcelain desktop skin</sub>
</p>

Oh-DSH-Desktop keeps the DSH React UI and packages a pinned DSH runtime,
Node.js, Electron, and local capabilities into a macOS application. Models
still run in the cloud. The desktop owns the terminal, workspaces, Git,
browser, window integration, and plugin lifecycle.

It is not a second DSH frontend and does not require a separate Web Terminal.
Desktop capabilities register as plugins and retain the official DSH Profile,
Loader, locale, settings, and ThemeService contracts where possible.

## Capabilities

- Self-contained Apple Silicon macOS application and installers.
- Multi-tab PTY Terminal, Workspace Review, Browser, and Files.
- Pinned Summary, expandable Side Panel, and native window controls.
- Plugin marketplace with isolated preview, discard, apply, and recovery.
- Live Chinese/English switching and four original Oh-DSH skins.
- One transaction and approval boundary for human and Agent plugin actions.

## Interface preview

**Plugin marketplace**: browse the `dsh-external` catalog and preview changes
in an isolated environment.

<p align="center">
  <img src="./assets/oh-dsh-plugin-marketplace.png" alt="Oh-DSH plugin marketplace" width="100%">
</p>

**Desktop skins**: switch instantly from DSH Settings, with the selection
persisted by the Host.

<p align="center">
  <img src="./assets/oh-dsh-desktop-skins.png" alt="Oh-DSH desktop skin settings" width="100%">
</p>

## Installation

### Install a test build

Download from
[GitHub Releases](https://github.com/dsh-external/oh-dsh-desktop/releases):

- `Oh-DSH-Desktop-0.1.0-arm64.dmg`
- `Oh-DSH-Desktop-0.1.0-arm64.zip`

Open the DMG and drag `Oh-DSH-Desktop.app` into `Applications`. The current
test build has no Developer ID signature or notarization. On first launch,
right-click the application in Finder and choose **Open** if required.

### Run from source

Requirements: macOS 12+, Apple Silicon, Node.js 24+, pnpm 11+, and Xcode
Command Line Tools.

```sh
pnpm install
pnpm run build:dsh
pnpm start
```

Release builds pin DSH `0.0.1-rc.1` at:

```text
e7f2790a2a863bfc23e5db483778fd12801cf9bf
```

The first build stores the source under `.cache/dsh-source/`. Set
`DSH_SOURCE=/absolute/path` to use another checkout; its package version must
still match the pinned version.

Writable runtime state lives at:

```text
~/Library/Application Support/Oh-DSH-Desktop/dsh
```

Configure the DeepSeek API key in DSH Settings or in the `.env` file under
that directory.

## Desktop controls

| Action | Shortcut |
| --- | --- |
| Toggle the DSH left sidebar | `⌘B` |
| Toggle the bottom Terminal | `⌘J` |
| Toggle the Side Panel | `⌥⌘B` |
| Open Review | `⌃⇧G` |
| Open Browser | `⌘T` |
| Open Files | `⌘P` |
| Start a Side chat | `⌥⌘S` |
| Leave Side Panel focus mode | `Esc` |

Opening the Side Panel collapses Pinned Summary and reveals the expand
control. Terminal and Side Panel remain independently toggleable.

## Architecture

```mermaid
flowchart TB
  App["Oh-DSH-Desktop.app<br/>Electron shell"]
  Runtime["Bundled Node.js + DSH runtime"]
  UI["DSH React UI"]
  Shell["desktop-shell<br/>window · menu · PTY"]
  Panels["panel-controls<br/>terminal · bottom panel"]
  Sidebar["desktop-sidebar<br/>registry · review · browser · files"]
  Summary["pinned-summary<br/>session summary"]
  Market["plugin-marketplace<br/>preview · apply · recover"]
  Skins["desktop-skins<br/>theme · persist"]

  App --> Runtime --> UI
  Runtime --> Shell
  UI --> Panels
  UI --> Sidebar
  UI --> Summary
  UI --> Market
  UI --> Skins
```

`cordis.patch.yml` reuses `dsh-base` and `dsh-web-app`, starts the Web runtime
on a random loopback port, and loads desktop plugins in dependency order.
Third-party plugins remain managed by the DSH Profile and Loader.

## Bundled plugins

| Plugin | Upstream relationship | Oh-DSH adaptation |
| --- | --- | --- |
| `@oh-dsh/desktop-shell` | Original Oh-DSH component | Electron bridge, native menus, windows, and Agent management |
| `@oh-dsh/panel-controls` | Downstream adaptation of [`dsh-web-panel`](https://github.com/dsh-external/dsh-web-panel) | Rewrites the PTY host and Terminal dock for the current UI, themes, localization, and Session state; no separate Web Terminal installation |
| `@oh-dsh/pinned-summary` | Original Oh-DSH component | Active Session summary, half-height card, and conversation gutter |
| `@oh-dsh/desktop-sidebar` | Downstream adaptation of [`DSH-better-sidebar`](https://github.com/dsh-external/DSH-better-sidebar) | Distills registration lifecycle, Session tabs, viewers, and feature switches while retaining Oh-DSH layout, icons, and themes |
| `@oh-dsh/plugin-marketplace` | Distills [`plugin-registry`](https://github.com/dsh-external/plugin-registry) and [`dsh-hub`](https://github.com/dsh-external/dsh-hub) | Unifies isolated preview, risk review, TOFU source locks, apply, and recovery with desktop navigation and bilingual UI |
| `@oh-dsh/desktop-skins` | Downstream adaptation of [`dsh-skins`](https://github.com/dsh-external/dsh-skins) | Retains the ThemeService extension model but redesigns skins, Settings UI, and Host persistence |
| `@oh-dsh/desktop` | Original Oh-DSH component | Root bundle with a stable registration order |

Plugins marked as downstream adaptations or distilled designs are reviewed
against upstream releases and features regularly. Compatible features are
ported through the current DSH contracts; syncing does not overwrite Oh-DSH
UI, themes, or desktop interactions.

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for source and license
details.

## Plugin marketplace

The **Plugins** page browses the `dsh-external` catalog. Install, update,
enable, disable, and uninstall operations first create an isolated candidate
Profile:

```text
verify the source and exact commit
        ↓
install and launch an isolated preview Profile
        ↓
discard (live desktop unchanged) or apply (retain previous)
        ↓
Undo restores the previous Profile when needed
```

The Agent can enter the same workflow through conversation. Apply and recover
still require human approval and cannot bypass preview or introduce a second
DSH Loader. Private repositories authenticate through GitHub CLI:

```sh
gh auth login
```

## Security boundaries

- DSH Web runtime and Agent management bind only to random loopback ports.
- Browser uses an isolated Electron partition without Node.js or preload.
- The Files API validates real paths and rejects Workspace escapes.
- Marketplace candidates pin Git commits, block install scripts by default,
  and leave the live Profile unchanged until apply.
- The pnpm release-age policy stays enabled, excluding only `@deepseek-ai/*`.

## Local build and release

A complete build rebuilds the pinned DSH source. Use the quick build when the
cache is already current:

```sh
pnpm run dist:mac
# or
pnpm run dist:mac:quick
```

Artifacts are written to `release/`:

```text
release/
├── Oh-DSH-Desktop-0.1.0-arm64.dmg
├── Oh-DSH-Desktop-0.1.0-arm64.zip
└── mac-arm64/Oh-DSH-Desktop.app
```

The repository does not currently rely on GitHub Actions for release builds.
Verify locally before upload:

```sh
pnpm run typecheck
pnpm test
pnpm run dist:mac
pnpm run smoke:app
codesign --verify --deep --strict \
  release/mac-arm64/Oh-DSH-Desktop.app
hdiutil verify release/Oh-DSH-Desktop-0.1.0-arm64.dmg
```

After verification, create the Release manually. For an existing Release,
use `gh release upload --clobber` to replace the artifacts.

```sh
gh release create v0.1.0 \
  release/Oh-DSH-Desktop-0.1.0-arm64.dmg \
  release/Oh-DSH-Desktop-0.1.0-arm64.zip \
  --title "Oh-DSH-Desktop 0.1.0" \
  --generate-notes
```

## License

[BSD 3-Clause](./LICENSE)
