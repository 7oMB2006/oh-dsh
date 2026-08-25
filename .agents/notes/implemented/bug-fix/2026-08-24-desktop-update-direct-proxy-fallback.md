# Agent Note: Retry Desktop updates directly when the configured proxy is dead

Status: implemented

English | [中文](2026-08-24-desktop-update-direct-proxy-fallback.zh.md)

## Problem

Issue #113 reported that Desktop updates were permanently broken
("软件更新无效"): the update window failed every check with
`net::ERR_PROXY_CONNECTION_FAILED`. `syncUpdaterProxy` copies the OS proxy
rules Chromium resolves for github.com onto the `electron-updater` partition
session. When the OS proxy points at a local client that has stopped, every
update check and download fails forever: Chromium on macOS and Windows ignores
`HTTPS_PROXY`/`NO_PROXY` overrides, and the pinned rules lose Chromium's
dynamic proxy fallback. The earlier message-level mitigation (actionable error
text plus the Release-page link) could not make an update actually succeed.

## Decision

- `DesktopUpdateManager` accepts a `bypassProxy` hook. Check and download wrap
  their updater call in a one-shot retry with the proxy bypassed when the
  failure is proxy-connect class (`ERR_PROXY_CONNECTION_FAILED`,
  `ERR_TUNNEL_CONNECTION_FAILED`, `ERR_PROXY_AUTH_UNSUPPORTED`).
- Once the bypass engages it holds for the session: `syncUpdaterProxy` keeps
  the updater session direct instead of re-copying the broken OS proxy rules.
- While a retry is possible, the updater `error` event for a proxy failure is
  not published, so the window never flashes a dead-end error before the
  retry lands.
- `PROXY_AUTH_REQUIRED` keeps its sign-in-to-the-proxy message: an
  authenticating proxy usually guards a network where direct access would not
  reach GitHub anyway.

## Alternatives considered

**Message-only mitigation.** Rejected: the user still cannot update; the
issue stayed open after that shipped.

**Set the default session to direct.** Rejected: it would change proxy
behavior for the application's own web content, not just the updater.

**Honor `HTTPS_PROXY`/`NO_PROXY` environment overrides.** Rejected as the
primary fix: Chromium ignores those on macOS and Windows, and a dead
configured proxy still needs a direct fallback.

**Bypass on every failure code.** Rejected: it would mask real network and
server errors behind an extra direct attempt and delay actionable messages.

## Consequences

- Updates succeed when the OS proxy is stale but GitHub is reachable
  directly — the common misconfiguration behind issue #113.
- If the direct retry also fails, the surfaced error reflects the direct
  network condition rather than the dead proxy.
- One retry per session; the proxy is not re-attempted afterwards.
- Tests cover the check retry, the download retry, the once-per-session
  bypass, non-proxy failures not bypassing, and event suppression.
