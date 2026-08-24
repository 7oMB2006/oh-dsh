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
  an AppImage under `~/.local/bin` for Linux desktop, and a payload plus
  `ohdsh` symlink for web/tui. Only the desktop surface ever registers an
  application entry.
- Verify every download against the `digest` (sha256) field the GitHub REST
  API already publishes for every asset. This covers every existing release
  without changing the release workflow, and fails closed when a digest is
  missing or mismatched.
- Install transaction: resolve the latest stable release (`releases/latest`,
  so prereleases are never selected implicitly; `--version` pins a tag and
  can install one explicitly), download, verify, extract and validate in a
  temp directory, then swap into place with the previous installation moved
  aside. Marker files (payload `.oh-dsh-install.env`,
  `~/.local/share/oh-dsh/desktop/install.env`) make same-version re-runs a
  no-op unless `--force` is passed, and `--uninstall` reverses an install.
- macOS desktop installs use the zip artifact (ditto-preferred extraction)
  rather than the DMG; the running app is asked to quit only when the
  destination is the default `/Applications` path, so custom destinations
  and tests never touch the live session.
- Keep the script Unix/macOS only. On Windows (including Git Bash, which
  the script detects and refuses), the documented path is the `.exe`
  installer or the portable `win-x64` archives.
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

**A Windows PowerShell counterpart.** Rejected for this change: the NSIS
`.exe` already covers Windows desktop, and web/tui `win-x64` archives are
self-contained; the script refuses Windows shells with an actionable
pointer instead.

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
- Installer bookkeeping lives under `~/.local/share/oh-dsh` and inside the
  payload; `~/.ohdsh` remains exclusively the shared application data root
  owned by `src/data-root.ts`.
- The test suite for the installer runs on macOS and Linux hosts only
  (Windows skips); CI covers it on three matrix legs.
