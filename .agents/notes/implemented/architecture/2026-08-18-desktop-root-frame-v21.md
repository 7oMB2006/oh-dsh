# Agent Note: Desktop v21 owns the browser root frame

Status: implemented

English | [中文](2026-08-18-desktop-root-frame-v21.zh.md)

## Problem

The desktop client needs one owner for the sidebar, conversation, details panel, and overlay slots. The shipped DSH ui-layout also owns the root grid and removes panel entries during its collapse settle path, while the desktop surface needs a slower visible column transition and stable child mounts. The v20 fix disabled that transition and added an edge rail, which hid the symptom but did not establish a layout owner.

## Decision

The Oh-DSH desktop bundle disables ui-layout and inserts the private @oh-dsh/desktop-frame client plugin. The plugin registers the root slot with sidebar, conversation, details, and shell.overlay children, keeps those children mounted, and owns sidebar/details widths, narrow-window collapse, drag handles, theme-token projection, and the layout service. Its grid uses the DSH slow transition variables; drag operations temporarily disable the transition.

The desktop frame is a composition layer, not a replacement for the child feature plugins. Sidebar, conversation, details, overlay, theme, and runtime services continue to enter through their existing slots and injected services. The frame does not add a second menu, title bar, or session renderer.

Visible timing measurements are valid only when the packaged window is foregrounded, unobstructed, and reports document.visibilityState === visible with document.hidden === false. A background or covered Chromium window can throttle timers and animation callbacks, so those samples are not evidence of renderer jank. Acceptance checks inspect the column track over animation frames and record long tasks separately.

## Alternatives considered

**Keep ui-layout and tune its collapse delay** — this preserves two competing root owners and cannot guarantee that child entries remain mounted during the transition.

**Keep v20 immediate rail workaround** — it removes the visible transition and leaves the root ownership and timing problem unresolved; it is retained only as a negative regression assertion.

**Move desktop behavior into each child plugin** — this duplicates width, responsive, and overlay policy across independent plugins and makes the root geometry impossible to audit in one place.

## Consequences

The desktop composition now depends on the DSH slots and theme/runtime services at load time, and the private package must be built and staged with every desktop bundle. The frame adds a small amount of root layout code, but it gives one observable owner for column animation and preserves child lifecycle stability. The acceptance package must be tested in a real foreground window before animation smoothness is claimed.

Switching between distinct non-blank sessions closes the details panel before the new session is painted, matching the upstream layout contract. On Windows, the renderer-owned titlebar controls are installed in both the main window and isolated plugin preview windows; only the main window exposes the native application menu.
