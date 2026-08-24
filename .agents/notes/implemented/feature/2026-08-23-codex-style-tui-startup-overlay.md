# Agent Note: Add a Codex-style startup overlay to the TUI

Status: implemented

English | [中文](2026-08-23-codex-style-tui-startup-overlay.zh.md)

## Problem

The pinned dsh-TUI renderer opens with a whale/logo splash and several
renderer-branded information lines. Oh-DSH needs a product-owned startup
surface that reads like the Codex TUI while keeping the upstream renderer
and its upgrade boundary intact.

## Decision

- Replace the copied compiled `LogoV2.js` module with a guarded,
  product-owned startup overlay during renderer adaptation.
- Render the Oh-DSH title/version, model and effort, and directory in a
  compact rounded box with Codex-style labels.
- Keep the startup card content-sized and make the inline chat root, row, and
  ScrollBox content-sized for the whole session; only explicit fullscreen mode
  uses the viewport-filling scroll-to-bottom layout.
- Keep the shared transient overlay seam above its anchor, so command/file
  completion and picker/dialog menus remain inside the inline frame, and remove
  redundant startup margins between the card, context summary, and composer.
- Keep inline content anchored through dynamic turns by disabling the upstream
  automatic main-screen viewport reanchor paths under the Oh-DSH launch marker;
  explicit layout-change reanchors remain available.
- Omit any permission label from the startup card. The effective permission
  is session state that can differ after a resume or `/permission`, so a
  launch-time guess from the environment or the platform would misreport a
  security-relevant fact; the runtime's own status and permission flows stay
  the authoritative display.
- Do not mount the original upstream Logo tree: the staged renderer contains
  only the new overlay while the rest of the TUI remains upstream-owned.

## Alternatives considered

**Fork or edit the upstream TUI source.** Rejected because it would make
renderer upgrades and the pinned submodule boundary harder to maintain.

**Add a second TUI plugin loader or a new scene service.** Rejected because
the startup header is already owned by the renderer and the request needs no
new lifecycle or capability boundary.

**Only rename the existing wordmark and keep the splash layout.** Rejected
because the request is about the Codex information hierarchy, including the
boxed model, directory, and permissions rows.

## Consequences

- Startup renders Oh-DSH identity without shipping or exposing the upstream
  whale, animation, tip, gradient wordmark, or drift notice.
- The startup card carries no permission line; the runtime's existing status
  and permission flows remain the authoritative permission display.
- The adapter owns one exact compiled-module seam, so an upstream `LogoV2`
  signature or capitalization change fails packaging visibly and requires a
  deliberate adapter update.
