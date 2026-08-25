# Agent Note: desktop update failure recovery

Status: implemented

English | [中文](2026-08-21-desktop-update-failure-recovery.zh.md)

## Problem

The Desktop updater exposed raw Electron and Chromium failures directly in the
update window. A proxy outage could therefore present
`net::ERR_PROXY_CONNECTION_FAILED` with the generic `UPDATE_FAILED` code,
while the same error state offered both **Retry** and **Check Again** even
though both commands repeated the check. If the check failed before release
metadata arrived, the state also had no release URL, so the manual download
path disappeared at the moment it was needed.

The raw diagnostic remains useful to maintainers, but it is not recovery
guidance for a user. The updater needed one owner for error classification,
retry policy, the manual-release fallback, and the failure presentation across
the main-process manager, preload bridge, and update renderer.

## Decision

`DesktopUpdateManager` owns the recovery contract for every failed update
operation. It extracts a non-empty structured error code when one exists and
otherwise recognizes Chromium `ERR_*` codes embedded in an error message.
Known proxy, connectivity, DNS, timeout, refusal, and disk-space failures map
to concise recovery guidance. The complete original diagnostic is retained in
the updater log rather than copied into the user-facing message; unknown
failures continue to show their original bounded message.

Every error state carries the existing `retryable` decision. The update window
shows one primary **Try Again** action for retryable failures and withholds the
duplicate **Check Again** action; non-retryable failures may still offer
**Check Again**. The error code remains visible as a compact diagnostic label.

Every failure also carries a manual release destination. Once release metadata
exists, the manager keeps its exact release URL. Before metadata exists, it
falls back to the official Oh-DSH Releases index. `openRelease()` resolves the
metadata URL first and then the URL already published in the current state, so
the fallback remains actionable after an early check failure.

The update preload implements `DesktopUpdateBridge.brandIconDataUrl()` through
the existing `desktop:brand-icon` IPC handler. The failure renderer loads that
packaged official whale artwork on a best-effort basis and displays it only in
the error state. A missing or unreadable icon never changes update state or
recovery controls.

## Alternatives considered

**Keep raw updater errors in the window.** This preserves maximum detail but
leaves users to interpret Electron and Chromium internals. The raw value stays
in logs, while the window now carries the action the user can take.

**Keep both Retry and Check Again for retryable failures.** Both commands start
the same check from this state, so presenting both creates a false choice. One
primary action makes the retry contract explicit.

**Offer a release link only after metadata is available.** Network and proxy
failures commonly happen before metadata exists, which removes the fallback
from exactly those failures. The official Releases index is less specific than
a version page but remains valid without metadata.

**Embed or maintain a separate updater illustration.** A copied illustration
would create another brand asset and drift from the Desktop shell. Reusing the
packaged official whale through the existing IPC owner keeps one asset source;
failure to load it degrades to text and controls rather than blocking recovery.

**Automatically repair proxy settings.** The updater cannot safely infer or
mutate system proxy policy, credentials, or enterprise configuration. It
identifies the failure and offers retry plus manual release access, leaving
network remediation to the user or administrator. What this rejects is
touching system proxy policy; a later, session-local direct retry for the
updater's own session shipped separately and owns that behavior — see
[direct proxy fallback](2026-08-24-desktop-update-direct-proxy-fallback.md).

## Consequences

Update failures now provide stable error codes, targeted guidance, one retry
control, and a release fallback even when the metadata request never
completes. Maintainers retain the original diagnostic in logs, and unknown
errors do not lose their existing message.

The fallback deliberately opens the Releases index rather than guessing a
version-specific artifact. Known-code messages and retry policy are product
behavior owned by `DesktopUpdateManager` and must be updated with its tests.
Adding `brandIconDataUrl()` expands the update preload contract, so every
implementation of `DesktopUpdateBridge` must provide it. The image request is
best effort and does not become a prerequisite for recovery.

This decision improves recovery presentation. The underlying proxy connection
failure reported in issue #113 is now addressed by the separate
[direct proxy fallback](2026-08-24-desktop-update-direct-proxy-fallback.md)
decision, which retries the check or download once with the updater's proxy
bypassed; the error-presentation contract above stays current either way.

## Testing

`tests/update-manager.test.ts` covers a Chromium proxy code embedded only in
the error message, the redacted user guidance, retryability, the official
Releases fallback, and opening that fallback. Coverage of the direct retry
itself lives with the direct-proxy-fallback note. Existing updater tests
continue to cover structured proxy-authentication errors and unknown
retryable failures. The update failure window was also checked at its
packaged 720 by 620 viewport.
