# Agent Note: Resolve npm-release host dependencies from the deployed store

Status: implemented

English | [中文](2026-08-17-npm-release-host-dependencies.zh.md)

## Problem

Oh-DSH stages a pinned npm release assembly (DSH 0.1.0-rc.6) into
`.stage/dsh-runtime`. The RC.6 upgrade injected every plugin's
`ohDsh.hostDependencies` into the assembly manifest at the release version
so the frozen-lockfile install would place them in the runtime. Main's
`vision` plugin declares `@deepseek-ai/schemastery`, which the release
publishes at 3.18.1 — no `0.1.0-rc.6` exists for it. The injection therefore
broke `pnpm install --frozen-lockfile` and staging could not complete.

## Decision

- Drop the manifest injection entirely
  (`prepareNpmAssembly` / `collectHostDependencies`). The release graph
  already ships every host peer: direct DSH packages at the top level,
  transitive peers such as `@deepseek-ai/dsh-credentials` and
  `@deepseek-ai/schemastery@3.18.1` in the hoisted store, re-exported by
  `exposeHoistedPackages`.
- npm-release host dependencies link from the deployed runtime store via
  `runtimeDependencyTarget`, preferring the exact release version and
  falling back to any stored version — a forked peer keeps its own version
  line.
- `scripts/dsh-runtime-<version>-lock.yaml` (named from the pinned
  `DSH_SOURCE_SPEC.version`) is regenerated against the pristine release
  manifest, so its specifiers match the release graph (caret ranges), not
  the injected exact pins.

## Consequences

- `pnpm run stage:dsh` works with the vision plugin on the npm release.
- A host peer absent from the release graph fails loudly at link time
  (`DSH runtime is missing host dependency …`) instead of silently
  resolving to nothing.
- The committed runtime lockfile now equals the release's own resolution,
  so regenerating it after dependency changes is mechanical.

## Alternatives considered

- Keep the injection and special-case forked versions: adds a hand-maintained
  version map duplicating the release graph; rejected.
- Use the git-checkout `discoverSourcePackages` path for npm releases: the
  npm tarball is a single package with no workspace sources to discover;
  rejected.
- Regenerate the lockfile around the injected exact pins: cannot express
  `@deepseek-ai/schemastery@0.1.0-rc.6` because that version does not exist;
  rejected.
