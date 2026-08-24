# Agent Note: Drop the DCO signing instructions from AGENTS.md

Status: implemented

English | [中文](2026-08-24-drop-dco-instructions-from-agents-md.zh.md)

## Problem

AGENTS.md instructed every reviewer — human and automated — to treat a
missing `Signed-off-by` trailer on each PR-introduced commit as a merge
blocker and to enumerate those commits with git before commenting.
Automated reviewers quoted that section verbatim and applied it to
commit classes it was never meant to gate (merge commits carried by a
PR branch, rebased history), producing false-positive DCO findings that
cost review cycles to answer. The repository runs no DCO CI gate, so
the section was the only enforcement — and the only source of noise.

## Decision

- Remove the DCO signing mandate, the PR-commit enumeration recipe, and
  the unsigned-commit-blocks-merge rule from the "Commits and
  contributions" section of the repository-wide `AGENTS.md`.
- Keep every neighboring contribution rule unchanged: English commit
  and review language, the `<module>: <subject>` format, 72-character
  bodies, upstream license preservation, and PR hygiene.
- Reword the optional `Assisted-by:` bullet so it no longer references
  a DCO it no longer sits next to.
- Existing signed history stays as is; contributors may still sign
  commits, but no repository instruction asks a reviewer to check for
  it.

## Alternatives considered

**Keep the text and expect reviewers to scope it correctly.** Rejected:
the misfiring reviews were automated, and prose scoping rules do not
reliably steer them.

**Move the policy into `docs/` instead of deleting it.** Rejected: the
goal is that automated reviewers stop treating unsigned trailers as
merge blockers; a documented-but-inactive policy invites the same
findings from doc-reading reviewers.

**Enforce DCO with CI instead of instructions.** Rejected: it converts
the false positives into hard failures and adds a gate the project has
not asked for.

## Consequences

- Reviewers, including automated ones, no longer have a repository
  instruction to cite when flagging unsigned commits; DCO findings stop
  being actionable in this repository.
- The project relies on its CLA/contribution process rather than
  per-commit trailers for attestation; external policies that require
  DCO would need a CI gate to be meaningful again.
- The commit-format and review-language rules remain fully in force;
  only the signing mandate and its review recipe were removed.
