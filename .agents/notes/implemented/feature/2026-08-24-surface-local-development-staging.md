# Agent Note: Stage only the selected surface during local development

Status: implemented

English | [中文](2026-08-24-surface-local-development-staging.zh.md)

## Problem

The shared staging script installed every Oh-DSH Desktop, Web, and TUI package
for each local launch. That made `make tui` and `make web` pay for unrelated
surface packages and could leave a misleading all-surface runtime during
development.

## Decision

- Add `--surface all|desktop|web|tui` to `scripts/stage-dsh.mjs`; the default
  remains `all` for release and existing full-stage workflows.
- Define explicit package closures for each surface and remove unselected
  Oh-DSH package links and manifest dependencies before installing the selected
  closure.
- Make `make tui`, `make web`, and `make desktop` use their matching staged
  surface; keep `make stage` as the full shared stage.
- Keep the pinned DSH runtime and its required host dependencies shared; the
  optimization removes unrelated Oh-DSH surface packages, not core runtime
  capabilities required by the selected profile.
- The Makefile `upstream` target runs `git submodule update --init` on every
  build so checkouts follow the recorded gitlinks, and recompiles dsh-TUI only
  when its checked-out revision differs from the stamp under `.stage/`; an
  incremental checkout can no longer stage a stale compiled renderer as the
  new pin.

## Alternatives considered

**Keep one all-surface development stage.** Rejected because it slows local
startup and hides missing surface declarations.

**Maintain separate copy scripts for each interface.** Rejected because it
would duplicate dependency closure and staging-link logic.

**Infer packages from patch YAML at runtime.** Rejected because the explicit
surface closures are easier to review, test, and keep stable across packaging.

## Consequences

- Local TUI/Web staging is smaller and cannot accidentally load Desktop-only
  packages from a previous stage.
- Full staging remains available for distribution workflows with no flag.
- Adding a surface package now requires updating its explicit closure and the
  corresponding patch/profile contract.
