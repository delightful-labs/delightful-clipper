# Platform intake and persistence contract

**Updated**: 2026-11-04. Chromium direct clipping is implemented; incoming mobile sharing and image transport below are future contracts, not shipped capabilities.

## Chromium toolbar capture — implemented

A toolbar gesture first loads a confirmed account selection. Without it, a trusted sign-in popup must complete DLF restoration before any article/reference persistence or rendered-content capture. Cancel/invalid input authorizes nothing; success resumes the gesture. With a verified account connection, saving starts directly while retaining the source page. Background launch states validate the HTTP(S) tab and observed document ID, persist a bounded source reference and ensure one offscreen document. That trusted document owns DLF/local identity, serial native saves and packaged extraction workers. The source page receives only isolated-world serialization and a shadow-root status bar, with literal machine-owned feedback, Open article and Close. No website `postMessage` bridge can initiate a native save. Close hides presentation only and late progress cannot reopen it.

The manifest grants activeTab, scripting, storage and offscreen, without persistent source host permissions. The trusted sign-in popup and Options own recovery/restoration; matching the web account requires explicit restoration, not cross-origin SSO. Restoration drains issued old-account work before reopening the runtime and does not transfer queued old-account gestures to the new account.

Chrome storage also holds one nonsecret account/deployment confirmation; a stored local identity without that confirmation cannot clip. Native SDK account matching is independently required. Chrome storage holds at most eight small source references and issued markers, never captured HTML. Native Jazz article/intent/publication records own persistence and uncertain-write recovery. Issued references are not automatically replayed after restart; a lost dispatch acknowledgement is uncertain, not proof of failure. Rendered content is supplied through the same article operation as web Add Link. Web articles without content are processed by the dedicated serial worker. See the actual schemas in `apps/extension/src/protocol.ts` and [runtime contract](runtime.md).

## Installed PWA intake — future, unbuilt

Qualify a POST-based manifest share target for URL/text on supported Chrome Android installations. Its pre-session transport needs bounded durable handoff before redirecting to the app; this boundary remains to be implemented and must not revive the removed PWA article-intake graph or a second article database. If URL and text both contain the same URL, deduplicate; if multiple distinct URLs are present, retain input for correction instead of batch clipping. The response must not imply saved article content before the capture owner commits it. Offline/cold-start handoff must be qualified independently of the already implemented cached shell and native article persistence. No uploaded file intake is selected.

Account readiness is independent: preserve pending URL until owner selection is known. Do not auto-attach another person's pending intake after logout/login. Error page must retain the source URL and recovery path if local intake storage itself fails. A GET-only handler or app lifecycle memory alone does not satisfy cold-start durability.

Safari iOS uses Add Link; no unsupported incoming-share promise. All platforms retain direct paste. Operating-system background scheduling is not required; work resumes when a relevant runtime exists.

## Authenticated original pages

A user-triggered extension capture may read the current rendered page under granted permissions. Serialize a clone; strip extension UI/wrappers and active content. Preserve effective page base, selected quote/context and observed destination. Historical HTTP redirect chains are not always observable after navigation; record what was actually observed with its provenance. JavaScript redirects and publisher canonical candidates are observations, not unquestionable aliases.

A privileged extension fetch may obtain cross-origin image bytes only with the appropriate host permission. Page display alone does not prove CORS/canvas readability. Denied permission or protected assets yield partial image availability; do not forward site cookies to the server gateway.

## Service-worker cache boundary

Cache versioned shell, worker/WASM and bundled localization/font assets needed offline. The service worker must support navigation fallback for installed deep links, avoid caching auth/gateway responses, and upgrade the shell without dropping user article rows or native asset rows. SW Cache API and Jazz data storage have distinct owners and cleanup policies. Permanent deletion removes corresponding derived indexes/asset availability; normal shell upgrade does not.

## Local completion levels

- Transport reference retained: source URL/reference is available to its owner; this does not mean an article was saved.
- URL article locally saved: the native article operation confirmed local persistence; readable content may still be pending.
- Text readable offline: metadata and normalized body/native assets confirmed locally durable.
- Images locally complete: every chosen native asset bytes available on this device; unavailable assets listed separately.
- Sync pending/accepted/rejected: independent network/authority outcome, not inferred from local completion.

Browser quota/eviction remains a platform limitation. Request persistent storage when appropriate and report inability to persist, but do not claim that every browser guarantees indefinite offline storage. Storage-usage management UI remains deferred.
