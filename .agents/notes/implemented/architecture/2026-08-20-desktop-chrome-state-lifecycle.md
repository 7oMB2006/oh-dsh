# Agent Note: Desktop chrome follows native window lifecycle

Status: implemented

English | [中文](2026-08-20-desktop-chrome-state-lifecycle.zh.md)

## Problem

The renderer-owned Windows titlebar can display a stale maximize or restore state when the user changes the native window through the system controls rather than the in-page button. Pointer capture can also end through cancellation or capture loss without reaching the pointer-up handler, leaving the desktop frame in its dragging state.

## Decision

The main process remains the owner of native window state and sends maximize and unmaximize events through the isolated DesktopBridge. The renderer keeps an initial state query for startup, ignores that query when a newer native event has arrived, and unregisters the event listener with the menu bar. Desktop frame drag handles use one idempotent end path for pointer-up, pointer-cancel, and lost-pointer-capture, keyed by the active pointer id and clearing any pending animation frame.

## Alternatives considered

**Poll window state from the renderer** — this adds timing-dependent work and can still miss native transitions between polls.

**Update only after the in-page maximize button completes** — this leaves Snap Layouts, keyboard shortcuts, and native titlebar actions stale.

**Keep pointer-up as the only cleanup path** — this leaves cancellation paths able to retain drag state and pending frame work.

## Consequences

Every desktop and preview BrowserWindow can publish its native maximize state without adding a second renderer-side source of truth. The bridge now owns a removable window-state subscription, and drag cleanup is safe when capture-loss events follow an explicit capture release. The acceptance checks cover the event channel and all drag termination handlers, while real Windows interaction remains required for platform validation.
