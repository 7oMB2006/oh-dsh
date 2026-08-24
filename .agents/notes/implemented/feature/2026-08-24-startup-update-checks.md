# Agent Note: Startup update checks and installer-driven self-update

Status: implemented

English | [中文](2026-08-24-startup-update-checks.zh.md)

## Problem

Only the desktop could check for updates, and only manually through its
update window. Web and TUI installations had no way to learn that a newer
stable Release existed, and upgrading them meant re-running the installer
by hand. The maintainers asked for codex-TUI-style automatic update checks
on every surface, on every platform, once per launch, with the install
scripts performing the upgrade.

## Decision

- One shared check in `src/self-update.ts`: resolve the current version,
  fetch `releases/latest` from the public GitHub API (5s timeout, one
  attempt, opt out with `OH_DSH_UPDATE_CHECK=0`), and compare with `semver`.
  It fails closed and silently — offline or rate-limited launches behave
  exactly like today.
- Startup wiring: the TUI awaits the check with a 1.5s budget and prints
  one notice line before its first frame (so it survives in inline
  scrollback); Web fires the check without blocking and prints the notice
  after the listening URL; the desktop runs its existing
  `DesktopUpdateManager.check()` once per launch and shows a single system
  notification that opens the update window.
- `ohdsh update` upgrades packaged web/tui distributions on all platforms
  by downloading `install.sh`/`install.ps1` from the repository's main
  branch and running it for the detected surface. Source inference follows
  the Codex model — the running path, the payload's
  `.oh-dsh-install.env` marker, and the destinations recorded in
  `launcher.env` — rather than any flag baked into the build; the recorded
  `--dest`/`--bin-dir` are reconstructed so updates land where the install
  did, and roots the installers do not own are refused with guidance.
  Source checkouts are refused with a pointer to git; the desktop
  redirects to its own verified updater, which owns quit-and-replace
  lifecycle the shell path cannot safely replicate while the app runs.
- Updates are release-based only: surfaces compare against published
  stable GitHub Releases with semver. Commit-level rolling channels were
  explicitly rejected as too unstable for this project.
- The landing page shows the install command for the detected platform
  (curl one-liner on macOS/Linux, `irm | iex` on Windows) with the copy
  button.

## Alternatives considered

**Silent self-update on launch.** Rejected: replacing a running
installation without consent is a security and trust regression; the
notice-plus-command model keeps the operator in charge and matches the
codex-TUI precedent the maintainers cited.

**A per-surface updater binary or daemon.** Rejected: the install scripts
already own verified download, staging, and atomic swap; reusing them keeps
one upgrade transaction instead of three.

**Routing the desktop through install.sh as well.** Rejected: electron-
updater already provides signed, resumable, differential updates with
install-on-quit semantics; quitting the app from a shell script it is
running inside cannot match that lifecycle safely.

**Caching check results to at most one per day.** Not chosen: the explicit
requirement is one check per launch; each check is a single unauthenticated
GET and fails silently, so the cost is negligible.

## Consequences

- Every `ohdsh tui`/`ohdsh web` launch performs one unauthenticated GitHub
  API request (60/hr/IP limit shared with other clients); `GH_TOKEN`/
  `GITHUB_TOKEN` are honored when present. `OH_DSH_UPDATE_CHECK=0` is the
  supported off switch, and `OH_DSH_UPDATE_API_BASE` exists for testing.
- The TUI adds at most ~1.5s to startup on a slow network and zero on a
  fast one; a check that cannot answer within the budget is abandoned
  without a notice for that session.
- `ohdsh update` trusts raw.githubusercontent.com over TLS for the script
  itself (same trust root as `curl | bash`) and the script then applies its
  own digest verification to the release artifacts.
- The desktop notification appears once per session even if the update
  window is opened repeatedly; `autoDownload` stays off, so a startup check
  never downloads anything by itself.
