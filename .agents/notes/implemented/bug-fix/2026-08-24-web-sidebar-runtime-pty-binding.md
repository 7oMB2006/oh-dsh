# Agent Note: Reuse the staged runtime node-pty binding in Web/Desktop

Status: implemented

English | [中文](2026-08-24-web-sidebar-runtime-pty-binding.zh.md)

## Problem

The Better Sidebar package declared its own `node-pty@1.1.0` dependency. Surface
staging copied that dependency beneath the plugin while the pinned DSH runtime
provided a separately rebuilt `node-pty@1.2.0-beta.15`. On Linux the nested
copy had no native `pty.node`, so the Web terminal WebSocket closed before it
could emit shell output.

## Decision

- During Web/Desktop staging, link Better Sidebar's `node-pty` resolution to the
  staged runtime's top-level native package.
- Remove the dead nested POSIX store copy and rewrite the staged plugin manifest
  to the runtime package version; keep the source package declaration unchanged
  for its own workspace compatibility.
- Fail staging if the runtime-owned native package is absent instead of
  silently shipping a degraded terminal surface.

## Alternatives considered

**Keep the nested dependency and rebuild both copies.** Rejected because it
duplicates a native binding, increases the staged runtime, and permits the two
terminal surfaces to drift onto different ABI builds.

**Change the upstream Better Sidebar package manifest.** Rejected because the
submodule is pinned and its source dependency contract is not Oh-DSH's to
rewrite.

**Disable the Web terminal when the nested binding is unavailable.** Rejected
because the selected Web/Desktop surface already ships the runtime capability;
staging should make that capability loadable.

## Consequences

- Web and Desktop use the same native node-pty build as the pinned DSH runtime.
- Linux Web terminal smoke reaches the shell instead of the degraded close path.
- A future runtime node-pty upgrade must continue to satisfy Better Sidebar's
  compatible API contract.
