# Agent Note: Pin released surface extensions at their public seams

Status: implemented

English | [中文](2026-08-18-upstream-surface-extension-seams.zh.md)

## Problem

Oh-DSH adapts Better Sidebar and dsh-TUI while preserving one DSH runtime and
one product identity. Reusing upstream private UI internals made upgrades
fragile, while rebuilding published TUI artifacts inside an offline Nix build
caused an undeclared nested package installation.

## Decision

- Pin Better Sidebar and dsh-TUI to released commits, including dsh-TUI's
  nested ecosystem-spec and dsh-std revisions.
- Keep Better Sidebar host capabilities and render them through Oh-DSH's own
  Desktop and Web components.
- Let dsh-TUI own terminal rendering. Register the Oh-DSH marketplace through
  its public scene and shortcut services with the renderer's React and UI kit.
- Apply one guarded transformation to the copied compiled renderer. Do not
  transform upstream TypeScript sources.
- In Nix builds, assemble the pinned source graph for dependency resolution,
  but consume the matching published TUI artifact and bundled dsh-std packages.
  This keeps the build offline and avoids a second package installation.
- Build pinned DSH with its pnpm lock and release-age policy. Normalize the
  different pinned-source and llm-agents output roots during final assembly.
- Keep bilingual source discovery out of pinned upstream and generated release
  trees; those documents retain their own upstream or packaging lifecycle.
- Keep the legacy `dsh-cc-tui` identifier protected only for existing user
  configurations; new profiles use `@deepseek-harness-tui/dsh-tui`.

## Alternatives considered

**Fork both upstream clients.** This offered complete UI control but duplicated
renderers and made every upstream release a manual port.

**Run the upstream TUI build script in Nix.** The script performs a nested
`pnpm install`, which cannot be satisfied reliably in the offline sandbox.

**Add a second plugin loader for terminal extensions.** This would split trust,
preview, and recovery behavior from the shared DSH Profile and Loader.

## Consequences

- Upstream upgrades are limited to declared service seams and a checked
  compiled-renderer adaptation.
- Nix pins source commits and the matching published TUI integrity separately.
- Both DSH providers produce the same staged runtime layout despite their
  different Nix output roots.
- Upstream and packaged README files no longer enter Oh-DSH's source-document
  translation gate.
- Local source builds still verify upstream source, while release assembly can
  use upstream's published compiled renderer.
- Compatibility for the old TUI package name remains explicit and removable
  after existing configurations have migrated.
