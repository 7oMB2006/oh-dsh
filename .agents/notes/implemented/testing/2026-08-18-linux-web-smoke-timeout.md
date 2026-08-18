# Agent Note: Allow slow Electron startup in Web smoke

Status: implemented

English | [中文](2026-08-18-linux-web-smoke-timeout.zh.md)

## Problem

Linux release runners can spend more than 30 seconds starting the Electron
smoke client after the Web bundle is ready. The fixed timeout made an otherwise
healthy Web package fail before the client assertions ran.

## Decision

The Web smoke client waits up to 120 seconds by default. Maintainers can set
`DSH_SMOKE_CLIENT_TIMEOUT_MS` for a different positive timeout; invalid values
fall back to the same 120-second default.

## Alternatives considered

**Remove the Electron smoke from release packaging.** This would hide the
Desktop/Web integration contract instead of verifying it; rejected.

**Retry the Electron process without changing the timeout.** A retry would
double runner cost and could still fail under sustained startup contention;
rejected.

## Consequences

Slow Linux runners have enough time to reach the existing assertions, while a
hung client still fails within a bounded interval. Local runs may override the
window when diagnosing startup behavior.
