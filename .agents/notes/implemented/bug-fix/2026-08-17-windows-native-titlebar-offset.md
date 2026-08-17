# Agent Note: Keep native Windows titlebar separate from macOS overlay chrome

Status: implemented

English | [中文](2026-08-17-windows-native-titlebar-offset.zh.md)

## Problem

The Desktop client applies a 40px renderer offset and a fixed draggable chrome
layer on every platform. Electron hides the native titlebar only on macOS;
Windows keeps its native titlebar and application menu. The Windows content
therefore receives an extra top offset, and fixed Desktop surfaces inherit the
same incorrect titlebar height.

## Decision

The Desktop client reads the platform fact synchronously from the Electron
preload bridge and sets the shared titlebar offset to 40px on macOS and 0px on
Windows and Linux. The Desktop client chrome CSS fallback is zero, and fixed
Desktop surfaces receive the same value before the asynchronous metadata lookup
starts. That lookup only supplies preview identity; a lookup failure cannot
remove the installed window chrome. Teardown restores the prior inline value.
Windows keeps its native Electron titlebar; this change does not introduce a
second Windows window-controls implementation.

The Desktop client also applies the Web surface's measured Session log offset so
the download capsule yields space to the right-side header controls. The offset
is derived from the rendered control width, refreshed after header mutations and
resizes, and restored when the Desktop client effect is disposed.

## Alternatives considered

**Hide the Windows native titlebar and enable a window-controls overlay.**
Rejected for this issue because the current Windows configuration intentionally
uses native window chrome. That alternative would require owning draggable
regions, control safe areas, and Windows-specific window behavior.

**Keep the 40px offset on every Desktop platform.** Rejected because it
duplicates the native Windows titlebar and produces the reported empty region.

**Remove only the body padding on Windows.** Rejected because pinned summary
and marketplace surfaces also consume the shared titlebar offset and would keep
their Windows geometry displaced.

## Consequences

macOS retains its custom overlay titlebar. Windows and Linux content begins at
the top of the renderer viewport below native window chrome, and fixed Desktop
surfaces use the same zero offset. The platform-dependent style is installed
synchronously from the preload platform fact and is removed with the Desktop
client effect.
Desktop and Web keep the Session log control visible while the right-side header
controls change size or are re-rendered.

## Testing

The platform offset, metadata failure-path, and Desktop Session log offset tests
pass. `pnpm run typecheck`
and `pnpm run build` pass. `pnpm test` reports 180 tests: 177 passed, 1
failed, and 2 skipped; it exits with failure because the pre-existing Windows
environment cannot start `python3` in `tests/nix-collect-deps.test.ts` (9009).
The Windows x64 packaging command passes and produces the installer and
unpacked package. DevTools inspection of the rebuilt Windows package reports
zero body padding, zero titlebar pseudo-element height, and a root frame
starting at renderer viewport y=0. The Electron smoke preload exposes the same
synchronous platform field and the client smoke asserts the platform-specific
offsets. The Desktop smoke reached the client graph but timed out in its
existing workspace-dialog loop; the Web smoke is blocked by its existing
Windows PowerShell terminal command using unavailable `printf`.
