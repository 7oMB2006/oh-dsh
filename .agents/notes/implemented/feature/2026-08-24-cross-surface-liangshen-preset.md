# Agent Note: Share the Liangshen preset across application surfaces

Status: implemented

English | [中文](2026-08-24-cross-surface-liangshen-preset.zh.md)

## Problem

The Liangshen agent preset shipped inside dsh-TUI and was therefore only
discoverable after the TUI package installed its user-root copy. Web and
Desktop use the same DSH agent-preset service, but their staged deployments did
not contain that composition.

## Decision

- Add an Oh-DSH `@oh-dsh/liangshen` Host plugin to the Web and Desktop bundle
  patches. The plugin installs the pinned `presets/liangshen` composition into
  the shared user preset root before sessions are created.
- Skip the install when the surface starts as a read-only viewer
  (`OH_DSH_READ_ONLY=1`): the viewer shares the data root with an active
  surface, and installing would replace preset state that surface owns.
- Register the plugin in the Nix `full` and `web` assemblies through
  `nix/register-plugins.py`, staging the preset beside `dist/` from the
  pinned TUI release; the Nix TUI closure stays on the upstream preset.
- Do not mount that plugin in TUI; the pinned dsh-TUI renderer already installs
  and exposes its own Liangshen preset.
- Keep the preset source in the pinned dsh-TUI checkout so its tool-bootstrap,
  compaction, and delegated-agent behavior upgrades together with its owner.
- Keep `standard` as the default; Liangshen is opt-in through the preset
  selector, startup flag, or environment setting.

## Alternatives considered

**Copy the preset into the staged DSH config root.** Rejected because it would
make the preset a deployment asset rather than the explicitly scoped built-in
Web/Desktop plugin requested by the product boundary.

**Duplicate the preset under a new Oh-DSH plugin package.** Rejected because it
would create a second copy of a composition whose lifecycle and upstream
ownership already belong to dsh-TUI.

**Make Liangshen the default.** Rejected because it changes the model-visible
tool contract for existing users; availability is safe, opt-in behavior is
backward compatible.

## Consequences

- Web/Desktop Agent preset settings resolve the preset through the built-in
  plugin, while TUI continues to use dsh-TUI's native implementation.
- Surface-local staging includes the plugin only for Web and Desktop; TUI does
  not receive a duplicate Liangshen runtime package.
- Nix Desktop/Web resolve the plugin package and its preset exactly like the
  staged (non-Nix) deployment, guarded by
  `tests/nix-register-plugins.test.ts`.
- A dsh-TUI upgrade must revalidate the preset composition and its cross-surface
  staged copy.
