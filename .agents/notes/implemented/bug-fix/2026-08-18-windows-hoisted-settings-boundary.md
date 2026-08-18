# Agent Note: Locate the settings boundary in hoisted Windows staging

Status: implemented

English | [中文](2026-08-18-windows-hoisted-settings-boundary.zh.md)

## Problem

Windows release staging uses pnpm's hoisted linker, so the deployed
`dsh-host-apiproxy` package is not necessarily under `.pnpm`. The settings
boundary patcher only searched the copy-import layout and made Windows
packaging fail before Electron packaging began.

## Decision

`restoreSettingsBoundary()` first checks the `.pnpm` copy-import layout and
then checks the hoisted `node_modules/@deepseek-ai/dsh-host-apiproxy` layout.
Both paths resolve the same upstream `lib/index.js`, and the contract is
covered by fixtures for each layout.

## Alternatives considered

**Force Windows to use the copy-import linker.** This would hide the
platform-specific layout instead of supporting the release configuration and
could increase install time and disk usage.

**Skip the settings patch on Windows.** This would ship a different
configuration boundary on one supported platform; rejected.

## Consequences

Windows and POSIX release staging share the same settings boundary. A future
pnpm layout change still fails closed when neither known package path exists.
