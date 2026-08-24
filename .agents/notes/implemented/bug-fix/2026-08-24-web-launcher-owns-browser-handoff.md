# Agent Note: the oh-dsh web launcher owns the browser handoff

Status: implemented

English | [中文](2026-08-24-web-launcher-owns-browser-handoff.zh.md)

## Problem

DSH runtime 0.1.1-rc.2 (#122) gave `@deepseek-ai/dsh-web-app` a browser handoff driven by the `webStartup` service: the row resolves `openBrowser: !!js ctx.webStartup.openBrowser`, and the web-startup plugin defaults that value to `true` when no open flag is passed. PR #132 pinned `openBrowser: false` on the desktop surface's `web-runtime` row, but the Oh-DSH Web launcher (`src/web.ts`) spawns the runtime with only `--profile web --host --port --trusted-host` and never passes an open flag, so `webStartup.openBrowser` resolved to `true`: the bundle opened a second tab on top of the launcher's own handoff, and `ohdsh web --no-open` only silenced the launcher while the bundle still opened one tab.

## Decision

The launcher passes `--no-open` in the runtime spawn args, next to the existing `--host`/`--port`/`--trusted-host` flags it already routes over the same `webStartup` seam. The launcher remains the single decision point for opening the browser: its `--open`/`--no-open` flags, its `stdout.isTTY` interactive default, and the `DSH_OH_WEB_OPEN` env override all keep working, and the bundle never hand the URL to the OS browser.

## Alternatives considered

**Pin `openBrowser: false` in `web/cordis.patch.yml`.** Rejected because the web profile is also reachable standalone via `dsh --profile web`, where the upstream interactive open is the intended UX; a patch pin would suppress it for everyone. The flag keeps the suppression scoped to the launcher path.

## Consequences

`ohdsh web` opens exactly one tab (or zero with `--no-open`, or one forced with `--open`); standalone `dsh --profile web` keeps its upstream interactive default. If a future runtime revision renames or removes `--no-open`, the launcher fails loudly at runtime startup instead of silently double-opening. Verified live in a real PTY for all three flag paths, plus `pnpm run typecheck` and the existing test suite (228 pass; the 3 failures are the pre-existing Nix-only tests that cannot run on Windows).
