# Agent Note: Upgrade the pinned dsh-TUI renderer to 0.9.0

Status: implemented

English | [中文](2026-08-24-upstream-tui-0.9.0-upgrade.zh.md)

## Problem

The upstream renderer was pinned at 0.8.8 and its background registry check
reported newer releases inside Oh-DSH. Letting the upstream `/update` flow
mutate the TUI profile would bypass Oh-DSH's adapter and packaging contract.

## Decision

- Pin the dsh-TUI submodule and published renderer to upstream 0.9.0.
- Update the Nix source revision, GitHub source hash, npm tarball URL, and
  integrity hash together with the third-party notice.
- Keep Oh-DSH's guarded compiled-renderer adapter responsible for branding,
  startup layout, and the update-check gate.
- Disable the upstream background update check when launched through the
  Oh-DSH environment marker; future upgrades go through the Oh-DSH pinned
  release flow.

## Alternatives considered

**Run `/update` inside the user profile.** Rejected because it can install a
renderer that has not passed the Oh-DSH adapter or packaging checks.

**Only change the displayed current version.** Rejected because the runtime,
Nix source, npm artifact, and provenance notice would remain inconsistent.

**Track upstream `main` instead of a release.** Rejected because local source
and packaged Nix builds need a reproducible renderer artifact.

## Consequences

- The staged TUI runs dsh-TUI 0.9.0 and no longer emits the upstream automatic
  update notice under Oh-DSH.
- Updating dsh-TUI now requires one deliberate pinned upgrade and a fresh
  adapter/staging verification.
- The manual upstream update implementation remains in the copied renderer
  for compatibility, but it is no longer advertised by the background check.
