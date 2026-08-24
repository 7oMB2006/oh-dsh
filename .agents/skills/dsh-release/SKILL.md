---
name: dsh-release
description: This skill guides Oh-DSH stable application releases from version preparation through GitHub artifact publication and recovery. Use when preparing a vX.Y.Z release, changing package.json for a release, creating or pushing a release tag, monitoring the Release workflow, or recovering from packaging failure.
---

# Oh-DSH Stable Release

This skill covers the application release workflow in
[`.github/workflows/release.yml`](../../../.github/workflows/release.yml). The
runtime-only workflow is separate and must not be used for a stable application
release.

## Prepare a release PR

1. Start from an up-to-date `main` with a clean worktree. Confirm the target
   version has no local or remote tag or GitHub Release.
2. Set `package.json` to the numeric semver `X.Y.Z`; the `v` prefix belongs
   only to the Git tag `vX.Y.Z`.
3. Validate the invariant before publishing:

   ```sh
   VERSION="${VERSION:?set VERSION to the numeric X.Y.Z release}"
   node scripts/validate-release-tag.mjs \
     --tag "v$VERSION" --version "$(node -p "require('./package.json').version")"
   ```

4. Run `pnpm run typecheck`, `pnpm test`, `pnpm run build`, the Agent Notes
   checks, the bilingual pairing check, and `git diff --check`.
5. Commit the version change and any release-process maintenance in English,
   using `<module>: <subject>` with a body that explains why and impact. Open
   a PR that lists scope, checks, and the exact version/tag pair.
6. Do not create the tag until this PR is merged and `origin/main` contains the
   validated version.

## Cut and monitor the release

1. Fetch `origin/main` and tags. Derive the release values from the current
   manifest so this phase does not depend on a previous shell:

   ```sh
   VERSION="$(node -p "require('./package.json').version")"
   TAG="v$VERSION"
   ```

   Verify the checked-out `main` is the exact commit to release, the
   manifest/tag validation passes, and the target tag is absent remotely.
2. Create an annotated tag on that commit and push only that tag:

   ```sh
   git tag -a "$TAG" origin/main -m "Oh-DSH Desktop $TAG"
   git push origin "$TAG"
   ```

3. Find the `Release` workflow run for the tag with `gh run list`, then use
   `gh run watch <run-id> --exit-status`. Treat each matrix package as pending
   until the run finishes; inspect failures with `gh run view <run-id> --log-failed`.
4. On success, verify the GitHub Release and its expected desktop, Web, TUI,
   runtime, checksum, and updater-metadata assets before reporting completion.

## Recover from a packaging failure

Do not delete a tag while its workflow is still running. First capture the run
URL and failed job, confirm the failure is deterministic and source-related,
and confirm no Release or partial published assets require maintainer recovery.
For a source fix, delete only the verified failed tag, create a fix PR from
`main`, run the relevant checks, and wait for that PR to merge before retagging
the new `origin/main` commit:

```sh
git push origin --delete "$TAG"
git tag -d "$TAG"
```

Do not force-push or delete an unrelated tag. Reuse the release name only after
the failed tag is verified deleted, the fix PR is merged, and the new
`origin/main` commit passes version validation. For an infrastructure-only
failure, prefer rerunning the failed workflow when possible. If a Release or
assets already exist, stop and use the repository's maintainer recovery path
instead of deleting history.

## Handoff

Report the merged version commit, tag object and target commit, workflow URL,
final matrix result, Release URL, asset verification, and any unresolved gap.
