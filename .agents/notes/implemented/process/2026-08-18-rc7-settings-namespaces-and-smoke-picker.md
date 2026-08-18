# Agent Note: rc7 settings namespace boundary, release-age policy, and smoke picker flow

Status: implemented

English | [中文](2026-08-18-rc7-settings-namespaces-and-smoke-picker.zh.md)

## Problem

Upgrading the pinned runtime to DSH 0.1.0-rc.7 surfaced four adaptations:
rc7's api-proxy replaced its fixed settings allowlist with dynamic
namespace serving, removing the rc.6 configuration-client boundary; rc7
packages are published inside pnpm's minimumReleaseAge window; and the
hero workspace picker interaction changed for browser automation. The pinned
TUI's nested dsh-std workspace also requires pnpm 11.21.0, while Oh-DSH CI
previously installed pnpm 11.20.0.

## Decision

- **Settings namespace boundary**: rc7's dsh-host-apiproxy serves every
  registered namespace via settings.describe() and accepts settings writes
  to any namespace; the rc.6 staging patch (exposeVisionSettingsNamespace)
  only added one namespace to the upstream allowlist and cannot express the
  boundary anymore. Regular staging and Nix assembly now call one
  restoreSettingsBoundary() module, which re-adds the whole explicit allowlist
  on the deployed api-proxy:
  settings.describe filters namespaces to the Web preferences, product, and
  plugin allowlist plus model-provider namespaces, and every settings write
  (update/replace/mutate) refuses other namespaces with
  `settings-not-exposed`. The allowlist is WEB_SETTINGS_NAMESPACES
  (agent-loop, shell, locale, permission, ui-conversation, ui-theme,
  web-search-deepseek), PRODUCT_SETTINGS_NAMESPACES (ui-onboarding,
  settings) and oh-dsh-vision, matching the rc.6 exposedNamespaces() union.
  This keeps the configuration-client boundary recorded in
  [2026-07-30-config-plane-boundaries.md](../architecture/2026-07-30-config-plane-boundaries.md),
  [2026-08-10-web-plugin-configuration.md](../feature/2026-08-10-web-plugin-configuration.md),
  and
  [2026-07-31-permission-default-for-new-sessions.md](../feature/2026-07-31-permission-default-for-new-sessions.md)
  intact: a registering plugin still cannot become remotely readable or
  writable by default.
- **Release-age policy**: the pinned assembly's pnpm-workspace.yaml now
  mirrors the repository's minimumReleaseAgeExclude for '@deepseek-ai/*',
  so freshly published rc releases install without waiting out the age
  cutoff.
- **Package-manager alignment**: the repository dependency, CI jobs, and
  release jobs pin pnpm 11.21.0, matching the TUI's nested dsh-std workspace.
  Lifecycle scripts therefore use the already verified package manager
  instead of downloading a platform-specific pnpm engine during install. The
  peer policy also documents the tested React 19 TUI bridge for rc7 client
  packages whose published peer ranges still name React 18.
- **Smoke picker flow**: rc7 binds the hero workspace picker open on the
  trigger textarea (a card-level click no longer lands) and untrusted
  clicks land intermittently, so scripts/smoke-client.cjs alternates
  between the card and the textarea, stops clicking once aria-expanded
  flips, and never toggles an open picker shut. Unattended smoke runtimes set
  SSH_CONNECTION to select rc7's documented browse backend, then exercise
  its real in-app dialog. This keeps packaged and source smokes deterministic
  without automating a native OS dialog.
- **TUI marketplace restart marker**: the resume marker is advisory. Marker
  persistence failures, such as a read-only or full data root, are ignored so
  Apply and Undo still reach the shared marketplace transaction.

## Consequences

- Every assembly path patches the deployed api-proxy through one fail-closed
  module; the explicit allowlist, not the registering plugin, decides whether
  a namespace reaches configuration clients.
- Assembly installs work immediately after an rc publish.
- Fresh macOS x64 runners no longer fail identity verification while switching
  package-manager versions inside the TUI prepare script.
- Desktop and Web smokes exercise the same real browse interaction without
  depending on a platform-specific chooser implementation; attended use
  keeps rc7's automatic native picker selection.
- TUI marketplace actions remain usable when restart recovery metadata cannot
  be written; a later launch simply has no resume marker to consume.

## Alternatives considered

- Trust rc7's dynamic serving as-is: settings redaction is not fail-closed
  for secrets behind unions, intersections, or transforms (see
  config-plane-boundaries), and a loaded client plugin could read or
  mutate namespaces that never underwent Web-surface review; rejected.
- Prove rc7 redaction fail-closed and keep dynamic serving: the upstream
  seam does not promise it and proving it per release is not worth the
  boundary loss; rejected.
- Wait for the release-age cutoff instead of excluding: blocks the upgrade
  for up to a day after every rc publish; rejected.
- Disable pnpm's engine identity verification: weakens a repository safety
  policy when using the same version at both workspace levels is sufficient;
  rejected.
- Drive the native OS directory dialog from the smoke: platform-specific
  and fragile; rejected.
- Let restart-marker persistence block Apply or Undo: the marker is recovery
  metadata, not a transaction precondition; rejected.
