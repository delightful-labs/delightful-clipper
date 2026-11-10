# Live AT Protocol offline qualification — 2026-11-10

Production merge `168cd0b`, deployment `dpl_5qUpzSiG7Y8APNfgrW1rSQgQ9XD9`,
on `https://clipper.delightfullabs.com`. This continues the native auth review;
it records passing offline behavior and an unresolved direct-reader failure.
No application change or new SDK patch was retained or deployed in this work.

## Passed live checks

The user authenticated through the actual Bluesky flow in a dedicated Chromium
profile. A single clearly marked synthetic article was saved using Clipper's
existing Add link operation. Only extraction responses were supplied by the test;
provider authentication, account selection, Jazz storage and synchronization used
production services. This is not a capture gateway/parser qualification.

The entire browser was then closed. Two new browser processes reopened that
profile with browser networking disabled and DNS resolution blocked. HTTP cache
was cleared; service-worker CacheStorage and the native replica were retained.
The app, auth and Jazz services were unreachable from these browsers, not stopped
on the hosting platform.

Both restarts reopened the same remembered account and readable saved content.
A favorite added during the first offline process survived the second. After
reconnect, a separate browser with an empty local replica received the test article
and favorite, and opening from its library rendered the saved text. It reused the
real same-app session in memory; no recovery phrase or alternate identity provider
was used. This confirms remote propagation, not merely the original replica's UI.
It does not qualify fresh-device provider authentication, expired live credentials,
backend restart durability, refresh, revocation or network-wide privacy/erasure.

The native browser profile is retained locally for continuation. No cookie export,
profile, password, token, account identifier, recovery material or trace is checked
into this repository. The marked article remains in the user's private library.

## Unresolved production reader issue

In a fresh local replica, hard navigation to the saved reader URL twice failed
its original 30-second assertion. The page returned HTTP 200 from the service
worker, reached the reader route and displayed “This article is not available on
this device. Reconnect and open it again.” while online. Opening the same article
from the library succeeded, including its saved text and synchronized favorite.
No failed HTTP response or Window exception was observed in the routing diagnostic.

This is not evidence of lost source data or failed favorite synchronization. It
is also not a passing direct-reader test. Its app/SDK cause is not yet established;
no timeout increase, automatic retry or speculative account/read coordinator was
retained as a repair. An unproven initial-load-wait change was removed.

One early local test returned 404 from the fixture server rather than reproducing
the live failure. The helper now serves the existing public shell for canonical
article routes, using the application's `isArticlePath` predicate. Unknown paths
retain their existing behavior; no private reader responses are added to a cache.
With this correction, genuinely cold reader URL coverage passes on unchanged
application code for linked, existing and expired-session fixture scenarios.
It expands coverage but does not reproduce or close the production-only issue.

## Local validation

All eight production offline cases pass with the additional cold-reader check.
The cases retain their complete browser-process restarts, durable offline edits,
reconnect, expired-session and sign-out assertions. Temporary structural probes
and diagnostic worker hooks have been removed. Further production-reader
investigation remains required before broad reader/release qualification.
