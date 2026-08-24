# Agent Note: Use a release skill for stable application publishing

Status: implemented

English | [中文](2026-08-24-release-skill-for-stable-publishing.zh.md)

## Problem

Stable Oh-DSH releases require the package manifest version, the `v`-prefixed
tag, the release workflow, and the GitHub Release assets to stay aligned. The
workflow rejects a tag that does not match `package.json`, but the recovery
steps for a failed packaging run were not recorded in one reusable place.

## Decision

- Add `.agents/skills/dsh-release/SKILL.md` as the agent-facing procedure for
  stable application releases.
- Keep the version and tag forms explicit: `package.json` uses `X.Y.Z`, while
  the release tag uses `vX.Y.Z`; validate the pair before any tag push.
- Require a release-preparation PR to merge before tagging `origin/main`, then
  monitor the `Release` workflow and verify the published asset set.
- For a deterministic source-related packaging failure, remove only the
  verified failed tag, submit a fix PR, wait for its merge, and tag the new
  main commit. Existing Releases or published assets require maintainer
  recovery rather than blind deletion.

## Alternatives considered

**Document the procedure only in `docs/usage.md`.** Rejected: user-facing
usage documentation is not the right surface for agent-only tag, CI, and
rollback guardrails, and it would make operational instructions harder to
discover at the point of release work.

**Push the tag first and repair the inevitable version mismatch afterward.**
Rejected: the release workflow has a deterministic version gate, so this would
create an avoidable failed release run and remote tag mutation.

**Automate all tag deletion and PR recovery in a script.** Rejected: deleting
remote release history and deciding whether a failure is source-related or
infrastructure-related require inspection and should remain explicit.

## Consequences

- Release agents have one concise procedure with the repository's actual
  workflow and asset boundaries as its source of truth.
- Every stable release needs a merged version-preparation change before its
  tag can be published.
- Recovery remains deliberate and credential-free; the skill never embeds or
  prints API keys.
- The skill does not replace GitHub Actions or maintainer judgment when a
  partial Release has already been published.
