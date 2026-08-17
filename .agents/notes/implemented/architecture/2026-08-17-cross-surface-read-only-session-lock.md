# Agent Note: Cross-surface session ownership and read-only viewers

Status: implemented

English | [中文](2026-08-17-cross-surface-read-only-session-lock.zh.md)

## Problem

Desktop, Web, and TUI each launch an independent DSH runtime process against
the same shared data root. DSH JSONL session persistence allows only one live
writer per session and does not coordinate writers across processes. When two
surfaces write the same session concurrently, their independent sequence
cursors can interleave and corrupt the log.

## Decision

Add a data-root lock that designates one surface as the active writer. Later
surfaces are allowed to start as read-only viewers instead of being rejected:

- `tryAcquireRuntimeLock()` returns a write lock for the first surface, or a
  read-only result when another live surface already owns the root.
- Viewer runtimes receive `OH_DSH_READ_ONLY=1`.
- A host-side guard blocks `sessionPersistence.create()` and `append()` in
  viewer mode.
- Marketplace mounting and profile setup are skipped or minimized in viewer
  mode to avoid mutating state owned by the active surface.
- Lock files record launcher PID, runtime child PIDs, and process-start
  markers so stale-lock recovery does not bypass an orphaned runtime or a
  reused PID.

## Alternatives considered

- Rejecting every second surface outright: simple, but prevents viewing shared
  history while another surface is active.
- Per-session ownership tracking: more precise, but requires DSH runtime
  cooperation to report which sessions are active and who owns them.

## Consequences

- A second surface can inspect history without risking concurrent writes.
- Writes from viewer mode fail with a clear read-only error.
- Existing corrupt logs are not repaired automatically.
- Stale reclaim locks are recovered only when the recorded owner is no longer
  alive; a live reclaimer's mutex is never stolen.
