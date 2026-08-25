# Agent Note: Collapsible workspace change summary

Status: implemented

English | [中文](2026-08-24-collapsible-workspace-change-summary.zh.md)

## Problem

The workspace review sidebar expanded every changed file list on startup and did not show a compact line-change summary before the file paths. This made a repository with several edits consume the panel height immediately and hid the amount of work behind an open list.

## Decision

The Changes section starts collapsed and uses its title row as the toggle. The row exposes `aria-expanded` and a rotating SVG chevron. While the workspace panel is open, the compact summary uses two scoped aggregate Git diffs and reads untracked text files through the existing filesystem API. Opening the section controls the file list and adds scoped per-file reads without delaying the title summary. It counts added and deleted diff lines, shows green `+N` and red `-N` in the title, and repeats the per-file counts before each path. Binary or unavailable content reports zero counts rather than inventing a line total.

## Alternatives considered

**Keep the list expanded and only add counts.** Rejected because the requested default view needs to preserve vertical space and let the user choose when to inspect files.

**Change the upstream Better Sidebar Git protocol.** Rejected because the existing scoped `gitDiff`, `fsRead`, and `gitStatus` APIs already provide the required data; changing the protocol would widen the compatibility and runtime risk.

**Compute counts only from status letters.** Rejected because status letters identify the kind of change but cannot provide additions and deletions. The sidebar needs the actual diff text for meaningful counts.

## Consequences

The initial review panel is compact and stable across repositories with many edits. Opening the section performs additional scoped reads, so the title briefly shows a loading marker before counts arrive. Untracked text files receive useful additions counts, while binary files remain explicitly non-line-countable. The existing per-file diff expansion remains unchanged after the list is opened.

## Testing

`node --test tests/sidebar.test.ts tests/workspace-tools.test.ts tests/diff-stats.test.ts` passes with 12 tests. `corepack pnpm@11.21.0 run typecheck` passes. `corepack pnpm@11.21.0 run build` passes. `git diff --check` passes for the changed files.
