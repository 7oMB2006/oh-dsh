# Agent Note: Unified SVG language for the workspace sidebar

Status: implemented

English | [中文](2026-08-24-unified-workspace-sidebar-icons.zh.md)

## Problem

The workspace review sidebar used Unicode characters as pseudo-icons for Git changes, history, execution environment, branches, commit actions, and background processes. The desktop toolbar used inline SVGs, so the same panel mixed font-dependent glyphs with a vector icon language. Glyph metrics varied by platform and skin, and labels such as Local and Commit or push looked like unrelated sections instead of one workspace control group.

## Decision

The sidebar owns a small private WorkspaceIcon component with a closed name union and one 20px stroke treatment. It renders inline SVGs for navigation, refresh, add, close, changes, history, environment, branch, commit, process, and chevron actions without adding an icon dependency or changing the shared skin tokens.

Workspace facts now present a secondary label and a primary value for execution environment, current branch, and Git actions. The workspace directory and review-comment dismissal controls use the same icon language. Existing Git refresh, checkout, commit, push, comment, workspace selection, and process behavior remains unchanged.

## Alternatives considered

**Keep Unicode glyphs and tune the font.** Rejected because glyph appearance still depends on the installed font, platform rasterization, and skin typography; it cannot provide a stable product icon language.

**Add a third-party icon package.** Rejected because this surface needs only a bounded set of simple icons, and a dependency would add package weight and another visual source of truth without deleting meaningful code.

**Redesign the workspace data model together with the visual pass.** Rejected because the ambiguity was presentation-level. Changing Git state ownership or mutation contracts would expand the risk without improving the requested result.

## Consequences

The review sidebar has consistent icon geometry across Desktop skins and clearer grouping for repository facts and Git actions. The fact group gains a small amount of vertical height because each row now shows a label above its value. The closed icon union makes future additions explicit and keeps accidental Unicode pseudo-icons easy to detect in review and tests.

## Testing

node --test tests/sidebar.test.ts tests/workspace-tools.test.ts passes with 9 tests. corepack pnpm@11.21.0 run typecheck passes. corepack pnpm@11.21.0 run build passes. git diff --check passes.
