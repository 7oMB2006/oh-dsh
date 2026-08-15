---
# SPDX-FileCopyrightText: Copyright (c) 2026 Process Mission
# SPDX-License-Identifier: MIT
name: simplify
description: >-
  Simplify code or a patch by removing dead code, duplicated facts, redundant
  abstractions, excess state, and unjustified compatibility paths while
  preserving required behavior. Use for cleanup, deduplication, reducing LOC
  or complexity, deepening modules, or narrowing over-generalized designs.
---

# Simplify

## Set the boundary

Treat required behavior, public contracts, ownership, permissions, data
migrations, and cross-surface compatibility as hard constraints. Read the root
`AGENTS.md`, inspect the worktree, and record the baseline in the task audit.

Optimize in this order:

1. Remove concepts, states, branches, and source lines.
2. Derive duplicated facts from one authoritative source.
3. Merge abstractions that split one invariant or workflow.
4. Generalize only around demonstrated variation.

Moving code into helpers or reformatting it is not simplification.

## Find excess

- Search declarations, production consumers, tests, docs, build files, and
  history before calling code dead.
- Treat a duplicated fact as a missing single source of truth.
- Treat one-mode registries, callbacks, wrappers, and fallbacks as candidates
  for deletion or narrowing.
- Treat forwarding-only interfaces as shallow modules; move policy and
  validation behind a smaller boundary.
- Keep compatibility paths only when a current requirement depends on them.

Classify each candidate as **delete**, **derive**, **merge**, **deepen**,
**narrow**, or **keep**. Choose the coherent option that removes the most
concepts with the fewest new rules.

## Change safely

- For review-only requests, stop with evidence and a reduction proposal.
- Otherwise, apply the smallest behavior-preserving reduction.
- Remove orphaned imports, types, configuration, tests, and documentation with
  the deleted model.
- Do not add dependencies, compatibility layers, generic helpers, or broad API
  changes merely to make the patch look smaller.
- Preserve unrelated worktree changes and pinned upstream code.

## Verify

Run the smallest sufficient build, test, smoke, and style checks for the
affected contract. Search again for orphaned consumers and stale configuration,
then run `git diff --check`.

Report removed concepts, retained behavior, evidence, and unresolved gaps. If
LOC is material to the request, measure the same source scope before and after;
never present lower LOC as success without behavioral evidence.
