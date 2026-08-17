# Agent Note: Retire stale duplicate macOS app bundles on first launch

Status: implemented

English | [中文](2026-08-17-retire-stale-mac-app-bundles.zh.md)

## Problem

The packaged macOS bundle changed its file name during the 0.1.x series —
`Oh-DSH-Desktop.app` (v0.1.0–v0.1.3) became `Oh-DSH Desktop.app` (v0.1.4+)
while keeping the same bundle identifier (`ai.deepseek.oh-dsh-desktop`).
Users who install from the release DMG by dragging the app into /Applications
never run `scripts/install-mac.mjs`, so Finder keeps both bundles side by
side instead of replacing the old one: two apps end up sharing one bundle
identifier, and Dock, Spotlight, and auto-update can keep resolving the old
location. Issue #103 reports the duplicate that shipped with the visible
rename.

## Decision

On first launch of the packaged macOS app from /Applications, `bootstrap()`
calls `retireStaleMacBundles`. The migration probes the historical sibling
bundle names under /Applications, verifies each candidate's
`CFBundleIdentifier` matches the product bundle identifier and its
`CFBundleShortVersionString` is strictly older than the running version,
moves qualifying bundles into ~/.Trash under a timestamped name, unregisters
the stale path, and re-registers the running bundle with LaunchServices via
`lsregister`. A sibling whose version cannot be verified is never retired:
it is left in place and reported, because an unknown version must not count
as evidence of being older. The running bundle is never moved; a launch
straight from the mounted DMG (running path outside /Applications) never
touches /Applications; every failure is logged and never aborts startup.
This mirrors what `scripts/install-mac.mjs` already does for local installs
and closes the same gap for DMG installs.

## Alternatives considered

**Revert the bundle file name to `Oh-DSH-Desktop.app`.** electron-builder
derives the `.app` directory name from `productName` with no per-platform
override, and `productName` also drives the Linux desktop `Name=` and
Windows file metadata, so a global revert would regress other platforms'
display names. It would also move the duplication onto users of the three
already published `Oh-DSH Desktop.app` releases, and the docs and READMEs
already document the `/Applications/Oh-DSH Desktop.app` path.

**Rename the bundle during `afterPack`.** The DMG and ZIP targets resolve
the app path from `productName` (macPackager.js), so a post-pack rename
breaks artifact creation, and electron-builder has no option that decouples
the bundle file name from `productName`.

**Scan LaunchServices or Spotlight for every bundle with the identifier.**
Depends on index freshness and adds a slow scan at launch; probing the two
historical bundle names is deterministic and fast, and the identifier check
keeps unrelated applications out of scope.

**Keep the cleanup local to `scripts/install-mac.mjs`.** It never runs for
DMG drag-install users, which is exactly the gap the issue reports.

## Consequences

Upgrading from any published bundle name converges to a single application
after the first launch of the newer version; retired bundles stay
recoverable in the Trash. A user who launches the older of two installed
bundles is left alone, because siblings newer than the running version are
never retired. Same-name upgrades still rely on Finder's overwrite as
before. The retirement is best effort: when /Applications is not writable by
the current user the move fails, is logged, and startup continues.
`lsregister` re-registration makes Dock, Spotlight, and auto-update resolve
the running bundle after a retirement. The behavior is pinned by
`tests/mac-bundle-migration.test.ts`.
