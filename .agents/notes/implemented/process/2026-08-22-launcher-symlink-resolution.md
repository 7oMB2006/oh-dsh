# Agent Note: Launcher symlink resolution

Status: implemented

English | [中文](2026-08-22-launcher-symlink-resolution.zh.md)

## Problem

The macOS install docs suggest `sudo ln -sf` of `bin/ohdsh` into
`/usr/local/bin`, but the launcher computed its root from `$0` without
resolving symlinks and reported the misleading "Oh-DSH is not built" from
`/usr/local` (#116).

The same release also degraded the read-only marketplace into a browsable
service; that decision belongs to the cross-surface lock owner note
([2026-08-17-cross-surface-read-only-session-lock](../architecture/2026-08-17-cross-surface-read-only-session-lock.md))
and is recorded there.

## Decision

`bin/ohdsh` resolves `$0` through symlink chains with a POSIX
`while [ -L ]` loop (macOS `readlink` has no `-f`) before computing the
root, so a `/usr/local/bin` link finds the installed application layout.

## Consequences

- The launcher works from any chain of relative or absolute symlinks on
  macOS and Linux; the Windows `ohdsh.cmd` is unaffected (cmd resolves
  its own script path).
- Covered by `tests/launcher-symlink.test.ts` (skipped on Windows).

## Alternatives considered

- Update the macOS docs to drop `ln -sf`: keeps the bug for every
  existing instruction on the web; the loop is six lines; rejected.
