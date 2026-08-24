# Agent Note: install.sh cross-surface release installer

Status: implemented

English | [中文](2026-08-24-install-sh-cross-surface-installer.zh.md)

## Problem

Users had to clone the repository or hand-pick archives from the Release
page to install Oh-DSH. The three surfaces are published as differently
named artifacts (electron-builder desktop packages, per-platform web/tui
tarballs), and only the runtime bundles carried `.sha256` sidecars, so
there was no single supported entry point that resolved, verified, and
installed the latest stable release for any surface.

## Decision

- Ship one POSIX `sh` installer at the repository root covering all three
  surfaces through `--surface desktop|web|tui` (default `desktop`). Each
  surface installs only its own files: an `.app` under `/Applications` with
  a Launch Services refresh and stale-bundle retirement for macOS desktop,
  an AppImage under `~/.local/bin` for Linux desktop, and a payload plus a
  generated dispatching `ohdsh` launcher for web/tui (see the launcher
  bullet below). Only the desktop surface ever registers an application
  entry.
- Verify every download against the `digest` (sha256) field the GitHub REST
  API already publishes for every asset. This covers every existing release
  without changing the release workflow, and fails closed when a digest is
  missing or mismatched.
- Install transaction: resolve the latest stable release (`releases/latest`,
  so prereleases are never selected implicitly; `--version` pins a tag and
  can install one explicitly), download, verify, extract and validate in a
  temp directory, then swap into place with the previous installation moved
  aside. Marker files (payload `.oh-dsh-install.env`,
  `<OH_DSH_HOME>/installer/desktop.env`) make same-version re-runs a no-op
  unless `--force` is passed, and `--uninstall` reverses an install.
- web/tui installs place a dispatching `ohdsh` launcher in the bin
  directory rather than a symlink: the web and tui payloads each carry only
  their own surface's dependencies, so one shared symlink would make the
  second install break the first surface. The launcher records each
  surface's destination in `launcher.env` under the installer data home and
  routes `ohdsh web`/`ohdsh tui` to the payload that provides the surface;
  uninstalling one surface refreshes the launcher for the remaining one.
- Markers are inert `KEY=value` text: values are charset-validated on
  write and parsed line-by-line on read (never sourced), destinations are
  recorded so desktop idempotency is keyed by the requested location, and
  the "already installed" fast path additionally verifies the app, image,
  payload, and launcher still exist so an ordinary rerun repairs them.
- Uninstall of a web/tui destination is gated on a matching surface marker
  before any recursive delete, and a legacy `Oh-DSH-Desktop.app` is retired
  only when its Info.plist proves this bundle identity and a strictly older
  version (plutil probes mirroring `src/mac-bundle-migration.ts`);
  unverifiable or newer bundles are left in place with a warning.
- Upgrades are replace-in-place: once the new installation is validated the
  previous app bundle, AppImage, or payload is deleted along with stale
  staging directories, so one surface keeps exactly one installation. The
  earlier behavior of moving the replaced macOS `.app` to `~/.Trash` was
  dropped when upgrade cleanup was added; backups now exist only between
  staging and validation.
- The GitHub JSON parsers normalize all whitespace before matching, so
  pretty-printed responses parse identically to compact ones.
- macOS desktop installs use the zip artifact (ditto-preferred extraction)
  rather than the DMG; the running app is asked to quit only when the
  destination is the default `/Applications` path, so custom destinations
  and tests never touch the live session.
- Windows installs through `install.ps1` (PowerShell 5.1+): the same
  resolution, digest verification, and staged swap for web/tui payloads
  under `%LOCALAPPDATA%\oh-dsh`, an `ohdsh.cmd` shim plus user-PATH
  management for the installer-owned default bin directory, and the NSIS
  installer's silent `/S` mode for the desktop. `install.sh` refuses
  Windows shells with a pointer to `install.ps1`.
- Tests (`tests/install-sh.test.ts`) drive the script against a local mock
  of the GitHub API and download endpoints via `OH_DSH_API_BASE` /
  `OH_DSH_DOWNLOAD_BASE`, a recording `lsregister` stub via
  `OH_DSH_LSREGISTER`, and `--os`/`--arch` overrides so macOS registration
  decisions are asserted on every host. They spawn the script
  asynchronously because a synchronous spawn would block the event loop
  that serves the mock, deadlocking the installer's curl.

## Alternatives considered

**Generate `.sha256` sidecars for all assets in the release workflow.**
Rejected: only the decoupled runtime bundles have sidecars today; the API
digest covers every asset of every past release with zero release-process
changes.

**Read `latest-mac.yml` for desktop checksums.** Rejected: it is
electron-updater metadata that covers only desktop artifacts and uses
sha512, while the API digest covers all surfaces uniformly.

**An interactive surface selector as the default.** Rejected:
`curl | bash` is non-interactive by nature; an explicit, documented
`--surface` with `desktop` as the flagship default keeps the one-liner
deterministic.

**A Windows PowerShell counterpart.** Rejected initially to keep the first
installer Unix-only while the NSIS `.exe` covered Windows desktop; reversed
by an explicit follow-up request once web/tui `win-x64` payloads needed the
same one-command install and `ohdsh update` needed a Windows upgrade path.
Shipped as `install.ps1`.

**Installing the macOS desktop from the DMG via `hdiutil`.** Rejected: the
zip artifact carries the same bundle without mount/attach lifecycle or
cleanup risk.

**Routing desktop upgrades through electron-updater.** Rejected: the
in-app updater already owns desktop self-updates; the shell installer
complements it for first install and scripted setup.

## Consequences

- The documented installer URL is `raw.githubusercontent.com/.../main/install.sh`,
  so the script evolves with the branch rather than being a frozen release
  asset; `release.yml` is unchanged. The landing page ships the one-liner in
  a copyable terminal block under the hero's surface cards, so the site and
  the installer URL must stay in sync manually.
- Release resolution depends on GitHub's compact REST JSON shape. The
  digest parser is dependency-free `awk`/`grep`/`sed` that isolates asset
  objects by their `},{` separators (nested `uploader` objects defeat a
  plain `{` split); any shape change that breaks digest lookup fails closed
  with an actionable message rather than installing unverified bytes.
- Unauthenticated installs share the 60 req/hr/IP GitHub API limit;
  `GH_TOKEN`/`GITHUB_TOKEN` are documented for constrained environments.
- Installer bookkeeping (launcher records, desktop markers) lives under
  `<OH_DSH_HOME>/installer` — inside the shared application data root owned
  by `src/data-root.ts`, so one override moves it with app state. Payloads
  stay under the XDG data home / `%LOCALAPPDATA%` because they are
  programs, not state. The web/tui packages bundle `install.sh` and
  `install.ps1` at `lib/oh-dsh/`, and `ohdsh update` prefers that bundled,
  version-matched script over a download.
- `tests/install-sh.test.ts` runs on macOS and Linux hosts and
  `tests/install-ps1.test.ts` on Windows (both against the shared mock
  GitHub server); each suite skips on the other platforms. The macOS
  desktop surface has no Windows counterpart test because a fake NSIS
  executable cannot be executed.
