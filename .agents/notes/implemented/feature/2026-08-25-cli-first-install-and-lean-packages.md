# Agent Note: Make command-line installation CLI-first and release payloads lean

Status: implemented

English | [中文](2026-08-25-cli-first-install-and-lean-packages.zh.md)

## Problem

The command-line installers defaulted to the Desktop package, which left Linux
users with only a native `oh-dsh-desktop` path and no registered `ohdsh` command.
The packaged runtime also carried Node headers, npm, development files, source
maps, and TypeScript declarations that are not needed by the shipped launch
path, making the installed Electron tree much larger than its compressed
download suggests.

## Decision

- Extend the [cross-surface installer decision](2026-08-24-install-sh-cross-surface-installer.md)
  by defaulting `install.sh` and `install.ps1` to the TUI surface. Web and
  Desktop remain explicit `--surface`/`-Surface` choices.
- Have each installer record a Desktop executable in the shared dispatcher
  records. The generated `ohdsh desktop` command launches that executable,
  while the direct `oh-dsh-desktop` entry remains available.
- Register the installer bin directory for new shells on Unix-like systems and
  new user terminals on Windows. Bash receives the entry in both
  `.bash_profile` and `.bashrc`; Zsh receives it in `.zprofile` and `.zshrc`;
  other shells use `.profile`. Existing shells are not mutated in place.
  Reinstalling with a new bin directory replaces the managed stanza, and its
  shell literal escapes apostrophes in valid paths.
- After native PTY compilation, stage only the runtime files needed to launch:
  strip non-Windows Node symbols, remove Node headers/share/npm tooling, and
  remove DSH runtime TypeScript sources, declarations, and source maps.

## Alternatives considered

**Install every surface by default.** Rejected: three independent archives
repeat the pinned Node and DSH runtimes, increase download and disk use, and
make a command-line install pay for interfaces it may never use.

**Keep Desktop as the default and document its absolute executable path.**
Rejected: it makes the first command-line install inconsistent with the TUI
workflow and leaves the shared `ohdsh` command unavailable until another
surface is installed.

**Remove the bundled Node or pnpm runtime and use system tools.** Rejected:
the release must keep its pinned cross-platform runtime, and marketplace
operations use the bundled pnpm entry.

**Prune files only in the Electron builder configuration.** Rejected: the
same staged runtime feeds Desktop, Web, and TUI archives; the staging boundary
is the single place that can keep all distribution surfaces consistent.

## Consequences

- A plain command-line install starts with `ohdsh tui`; `ohdsh web` and
  `ohdsh desktop` become available after their surfaces are installed.
- The dispatcher owns routing but does not replace the native Desktop entry.
- Idempotent Desktop installs verify both the native app and generated
  dispatcher, including when an explicit destination is used, so a missing
  launcher is repaired by an ordinary rerun.
- Runtime smoke and Web smoke must continue to run after pruning; startup-time
  optimization remains outside this decision.

## Verification

- Staged DSH runtime decreased from about 363 MB to 242 MB.
- Staged Node runtime decreased from about 241 MB to 132 MB.
- The local Linux AppImage probe decreased from 239,882,313 bytes in v0.1.9
  to 212,912,254 bytes with the same source and the lean staging rules.
- Runtime smoke, Web smoke, and the isolated full test suite passed.
