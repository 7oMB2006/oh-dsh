# Agent Note: Suppress the desktop surface's default-browser auto-open

Status: implemented

English | [中文](2026-08-24-desktop-suppress-auto-browser-open.zh.md)

## Problem

Since dsh 0.1.0-rc.8 the `web-app` bundle auto-opens the OS default browser after its webserver settles: `dsh --profile web` now serves and hands the URL to the browser unless `--no-open` is passed. Oh-DSH Desktop embeds that same bundle (`@deepseek-ai/dsh-web-app` is in `DESKTOP_BUNDLES`), so launching the desktop surface also opened a second browser tab at the loopback URL — even though the Electron shell already carves its own window and loads that exact URL itself.

The desktop's profile patch overrides the `web-runtime` row's config (`printUrl: true`, `surfaceContext: false`, `trustedHosts: []`) but did not set `openBrowser`, so the row fell through to the bundle's schema default of `true`.

## Decision

The desktop `cordis.patch.yml` (`web-runtime` row) now sets `openBrowser: false`. This keeps `printUrl: true`, so the runtime still prints `dsh web: <url>` and the supervisor's readiness line still fires. The desktop shell is the sole opener of that URL; the OS default browser is never handed the URL.

The standalone web surface is unaffected: `web/cordis.patch.yml` does not restate `web-runtime`, so the web profile resolves `openBrowser` dynamically from `ctx.webStartup.openBrowser` (the `--open`/`--no-open` flag family the `web-startup` plugin parses). The TUI profile does not bundle `web-app` at all.

## Alternatives considered

**Pass `--no-open` on the desktop runtime's spawned args.** Rejected because it couples the launcher to an upstream flag that may be renamed or removed, and the flag only exists for the `web` command line; the desktop already owns the surface's open behavior through its own patch config. Setting the config in the patch keeps the decision in the surface that makes it.

**Set `openBrowser` only when a `--open`/`--no-open` flag is present.** Rejected because the desktop does not expose those flags and never wants the handoff regardless of argv; a static `false` is unambiguous.

**Reuse the upstream `--no-open` default by removing the desktop's `web-runtime` override.** Rejected because the desktop override exists (it already replaces `printUrl`/`surfaceContext`/`trustedHosts`), and removing it would also drop those deliberate values.

## Consequences

The desktop no longer opens a second browser window. The URL line still prints, so desktop runtime supervision and the packaged web launcher remain unchanged. The `openBrowser` config now has a static default on the desktop surface, whose value is owned by the desktop distribution rather than the upstream bundle.

Pinned DSH releases newer than rc.2 keep the auto-open in `web-app`; the desktop patch pins it off regardless. The `ohdsh web` launcher no longer receives the upstream handoff: since it started passing `--no-open` to the runtime (see [2026-08-24-web-launcher-owns-browser-handoff](2026-08-24-web-launcher-owns-browser-handoff.md)), the launcher is the sole owner of that surface's browser handoff, and a standalone `dsh --profile web` keeps the upstream interactive default.
