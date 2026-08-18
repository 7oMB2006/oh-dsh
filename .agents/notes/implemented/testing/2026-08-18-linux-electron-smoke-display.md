# Agent Note: Run Linux Electron smoke under Xvfb

Status: implemented

English | [中文](2026-08-18-linux-electron-smoke-display.zh.md)

## Problem

Linux release runners can wait indefinitely while Electron creates the first
BrowserWindow when no display server is available. The packaged Web smoke then
fails even though the Web runtime is healthy.

## Decision

The packaged Web smoke invokes Electron through `/usr/bin/xvfb-run` on Linux
when the runner provides it. Other platforms keep the direct Electron path.

## Alternatives considered

**Increase the child timeout again.** The process waits while creating a
window, so a longer timeout only hides the missing display server; rejected.

**Replace the BrowserWindow smoke with HTTP-only checks.** This would stop
covering the browser client and native attachment behavior; rejected.

## Consequences

Linux CI now has a deterministic virtual display for the Electron client,
while local Linux systems without Xvfb retain the previous direct fallback.
