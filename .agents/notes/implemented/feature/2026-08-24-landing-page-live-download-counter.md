# Agent Note: Live download totals on the landing page

Status: implemented

English | [中文](2026-08-24-landing-page-live-download-counter.zh.md)

## Problem

The GitHub Pages landing page already shows the repository star count and
routes the download button to the newest matching Release asset, both fetched
client-side from the GitHub REST API. Total downloads — the number that shows
adoption — was nowhere on the page, and the page is static hosting with no
server component to aggregate it.

## Decision

- The landing page header gains a downloads pill next to the star pill,
  linking to the Releases index. It sums `download_count` across every asset
  of every release returned by `GET /repos/…/releases?per_page=100` in the
  visitor's browser — the same unauthenticated GitHub API the star count
  already uses, so no new infrastructure or token exists to leak.
- The aggregate is cached in `localStorage` (`oh-dsh-site-downloads`) with a
  30-minute TTL; a visit inside the TTL renders from the cache without a
  network request. Corrupt or blocked storage falls through to a live fetch,
  and a cache entry whose timestamp lies in the future — a device clock moved
  back after the write — is rejected so the badge cannot freeze on a stale
  total.
- The number counts up over 700 ms when it first appears;
  `prefers-reduced-motion` renders the final value immediately. Any fetch
  failure or non-positive aggregate keeps the pill's count hidden — the page
  never shows a wrong or zero total.
- Mobile widths hide both counts, matching the existing star-count rule.

## Alternatives considered

**A badge service (shields.io and similar).** Rejected: it adds a third-party
dependency and visual mismatch for a number we can derive from the same API
the page already calls.

**Server-side aggregation in the Pages build.** Rejected: the count would be
frozen at deploy time and only refresh on the next site build, which defeats
the "live" requirement.

**Fetching on every visit without a cache.** Rejected: unauthenticated GitHub
API calls are rate-limited to 60 per hour per client IP; a repeat visitor
burning a request on an unchanged total is waste. The star count stays
uncached because it was already shipped that way; changing it is not this
decision's scope.

**Per-platform or per-release breakdowns.** Rejected for the header: the pill
is a single trust signal; finer detail belongs on the Releases page it links
to.

## Consequences

- The total undercounts once the repository exceeds 100 releases unless the
  query is extended to follow pagination; revisit when release count
  approaches the cap.
- Visitors inside the cache TTL may see a total up to 30 minutes stale — an
  acceptable trade documented here.
- The pill shares the star-pill selectors in `website/site.css`; restyling
  one restyles both.
