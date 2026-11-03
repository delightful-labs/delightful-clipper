# Platform intake and persistence contract

## Installed PWA intake

Use a POST-based manifest share target for URL/text on supported Chrome Android installations. The service worker intercepts intake, validates exactly one source URL and writes it to a bounded intake journal before redirecting to the app. If URL and text both contain the same URL, deduplicate; if multiple distinct URLs are present, retain input for correction instead of batch clipping. The response must not imply saved article content before the capture owner commits it. Offline and cold-start paths use the cached shell and durable journal. No uploaded file intake is selected.

Account readiness is independent: preserve pending URL until owner selection is known. Do not auto-attach another person's pending intake after logout/login. Error page must retain the source URL and recovery path if local intake storage itself fails. A GET-only handler or app lifecycle memory alone does not satisfy cold-start durability.

Safari iOS uses Add Link; no unsupported incoming-share promise. All platforms retain direct paste. Operating-system background scheduling is not required; work resumes when a relevant runtime exists.

## Authenticated original pages

A user-triggered extension capture may read the current rendered page under granted permissions. Serialize a clone; strip extension UI/wrappers and active content. Preserve effective page base, selected quote/context and observed destination. Historical HTTP redirect chains are not always observable after navigation; record what was actually observed with its provenance. JavaScript redirects and publisher canonical candidates are observations, not unquestionable aliases.

A privileged extension fetch may obtain cross-origin image bytes only with the appropriate host permission. Page display alone does not prove CORS/canvas readability. Denied permission or protected assets yield partial image availability; do not forward site cookies to the server gateway.

## Service-worker cache boundary

Cache versioned shell, worker/WASM and bundled localization/font assets needed offline. The service worker must support navigation fallback for installed deep links, avoid caching auth/gateway responses, and upgrade the shell without dropping user article rows or native asset rows. SW Cache API and Jazz data storage have distinct owners and cleanup policies. Permanent deletion removes corresponding derived indexes/asset availability; normal shell upgrade does not.

## Local completion levels

- Intake durable: URL/journal persisted locally; article may still be pending.
- Text readable offline: metadata and normalized body/native assets confirmed locally durable.
- Images locally complete: every chosen native asset bytes available on this device; unavailable assets listed separately.
- Sync pending/accepted/rejected: independent network/authority outcome, not inferred from local completion.

Browser quota/eviction remains a platform limitation. Request persistent storage when appropriate and report inability to persist, but do not claim that every browser guarantees indefinite offline storage. Storage-usage management UI remains deferred.
