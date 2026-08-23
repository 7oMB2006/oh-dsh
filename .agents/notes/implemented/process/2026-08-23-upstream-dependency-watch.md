# Agent Note: Watch upstream dependencies with a scheduled bot reporter

Status: implemented

English | [中文](2026-08-23-upstream-dependency-watch.zh.md)

## Problem

Oh-DSH pins the DSH runtime through `dsh-source.json` (currently
`@deepseek-ai/dsh@0.1.1-rc.2`) and pins two plugin sources through the
`upstream/` submodules. Nothing announces new upstream releases: each
upgrade — like the 0.1.1-rc.2 bump — is discovered by hand, often days
after publication, and every DSH bump so far required contract
adaptation in `plugins/` that benefits from starting early.

## Decision

- A scheduled `Upstream watch` workflow (daily cron at 01:17 UTC, plus
  `workflow_dispatch`) runs `scripts/watch-upstream.mjs`.
- The script reads the pins from the repository itself — `dsh-source.json`
  for the npm runtime, `.gitmodules` plus `git ls-tree` gitlinks for the
  submodules — so there is no second version list to keep current.
- The npm check compares the registry's versions and `latest` dist-tag
  against the pin with semver (pre-release aware). The submodule check
  reports upstream tags newer than the pin (exact tag match, falling
  back to the pinned commit's date for pins past a tag) and how far the
  tracked branch has advanced beyond the pin.
- Findings become one issue per subject, labeled `upstream-watch` and
  created by `github-actions[bot]` through `GITHUB_TOKEN` with
  `issues: write`. An open issue whose title carries the subject's
  `[upstream-watch] <subject>` prefix suppresses a duplicate; closing an
  issue without moving the pin lets the next run re-open the subject.
- A subject whose checks fail fails the job, while finding updates
  exits 0 — findings are signal, not breakage. Without
  `GITHUB_TOKEN`/`UPSTREAM_WATCH_REPO` (or with `--dry-run`) the script
  is report-only, which is what a local run does.

## Alternatives considered

- **Dependabot or Renovate**: the npm pin lives in `dsh-source.json`,
  not a package manifest, so their npm ecosystem cannot see it; their
  submodule updates would move pins as PRs without the adaptation step
  the pinned-source rule requires. Rejected for both gaps.
- **One rolling digest issue updated daily**: a single thread cannot be
  closed per subject, and closure is how maintainers mark "handled";
  per-subject issues match the per-subject bump flow.
- **A hosted third-party watcher**: adds an external service with repo
  access for a job a scheduled workflow already does serverlessly.

## Consequences

- Awareness is automated while curation stays manual: the bot never
  opens PRs or moves pins, because DSH contract drift needs human
  adaptation before the surfaces can follow.
- Re-creation is deliberate: as long as a pin is behind upstream, every
  run after an issue is closed files a fresh one, so "not applicable"
  closures should come with a comment or a pin move the next day will
  honor.
- GitHub disables cron workflows on repositories with 60 days of
  inactivity; a quiet repository silently stops watching until any push
  or a `workflow_dispatch` run resumes it.
- The run costs one npm registry request and about three GitHub API
  calls per submodule — no token budget worth tracking.
