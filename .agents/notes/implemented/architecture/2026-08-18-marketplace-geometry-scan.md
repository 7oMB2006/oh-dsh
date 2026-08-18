# Agent Note: Marketplace geometry follows the open surface

Status: implemented

English | [中文](2026-08-18-marketplace-geometry-scan.zh.md)

## Problem

The marketplace plugin observed the whole document and scheduled geometry work
for every body mutation and sidebar resize, even while its surface was closed.
Its Settings lookup then measured every button in the document. The desktop
sidebar transition changes layout and triggers these observers, so the closed
marketplace could add long renderer tasks to an unrelated animation.

## Decision

Schedule marketplace geometry only while the marketplace surface is open. When
the surface is open, discover Settings controls from the declared sidebar
subtree and reuse each button's rectangle during one lookup. Opening the
surface schedules its first geometry pass; a pending pass rechecks the open
state before reading layout. A cheap footer-stack synchronization remains active while closed so collapsed
navigation stays vertically aligned without geometry reads.

## Alternatives considered

**Keep the global scan and tune the animation** — this hides an unrelated
observer cost inside the frame and leaves the cost proportional to every
marketplace card.

**Remove geometry synchronization** — this breaks the marketplace surface's
left edge when the sidebar or window is resized.

**Cache the Settings button forever** — this fails when DSH replaces the
sidebar subtree during session or responsive transitions.

## Consequences

Closed marketplace instances no longer perform layout reads during unrelated
DOM or sidebar activity. Open instances still resynchronize after mutations,
resize, and opening, but their candidate set is bounded by the sidebar. With
the marketplace closed, the v23 desktop collapse measurement no longer shows
the previously observed long tasks or large animation-frame gaps. An open
marketplace with a large catalog remains a separate content-reflow case.
