# Agent Note: persistent skin ownership during appearance changes

Status: implemented

English | [中文](2026-08-24-persistent-skin-ownership-during-appearance-changes.zh.md)

## Problem

Browser surfaces persist the selected Oh-DSH skin in the shared `skins.json`, but the theme runtime also publishes built-in `light`, `dark`, or `system` snapshots while Host Appearance settings hydrate. The skin controller treated every built-in snapshot as a user request to leave the active skin and removed `activeId`. A saved skin could therefore apply during startup and then disappear when a later settings read completed, returning the next launch to Original despite a successful earlier write.

The same event carries both startup hydration and explicit Appearance changes. The upstream theme service does not expose an event source or a readiness handle that downstream skin code can use to distinguish them.

## Decision

A valid `activeId` in `skins.json` remains authoritative until the skin owner removes it. When the controller adopts a built-in theme snapshot while a valid saved skin exists, it records that built-in preference as `fallbackTheme`, reapplies the saved skin, and keeps the skin snapshot and DOM presentation active. Invalid saved ids are still removed.

Selecting **Original** is the explicit operation that leaves a skin. `setSkin(null)` removes `activeId` before applying `fallbackTheme`, so the resulting built-in snapshot has no saved skin to restore and the controller clears its skin presentation. While a skin remains active, selecting Light, Dark, or Follow System updates the fallback that Original will reveal rather than implicitly deleting the skin.

This rule keeps skin identity and persistence inside `@oh-dsh/skins`. The upstream theme service continues to own built-in Appearance preferences and their Host settings document.

## Alternatives considered

**Wait on a second `ui-theme` settings scope before restoring the skin.** Every binding performs its own Host read. One scope can become ready before the theme runtime's private scope completes, so it is not a synchronization barrier and the later theme read can still clear the skin.

**Ignore only the first built-in theme event.** The event has no source field, and Host hydration may emit late or more than once after reconnects. Sequence-based suppression can discard a real user choice or fail on a later hydration.

**Reapply the skin after a fixed delay.** Settings and reconnect latency are not bounded by a stable product constant. A timer only moves the race.

**Persist the skin in browser localStorage.** Desktop and Web ports may change, and a second store would diverge from the shared `skins.json` used by all Oh-DSH surfaces.

**Extend the upstream theme settings schema with custom skin ids.** That transfers skin identity ownership away from `@oh-dsh/skins` and requires a DSH runtime contract change. The downstream owner can enforce persistence without expanding the upstream schema.

## Consequences

Saved skins survive startup hydration, delayed Host reads, and later built-in theme publications. The user leaves a skin through the skin gallery's Original option; Appearance choices made while a skin is active configure its fallback instead of replacing it.

The controller may reapply the same saved skin after reconnect-driven Appearance refreshes. Theme registration and application are idempotent for an already selected id, and preference storage coalesces unchanged writes.

`tests/skins.test.ts` covers delayed Appearance hydration after disk restoration, fallback updates while a skin remains active, and explicit Original clearing. The packaged Windows runtime is also verified through a full select, exit, restart, and delayed observation cycle.
