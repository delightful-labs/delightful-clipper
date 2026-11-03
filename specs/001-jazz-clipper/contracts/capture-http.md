# First-party capture HTTP boundary

**Status**: resolve/extract implemented behind a disabled-by-default deployment qualification flag; asset remains proposed. See [gateway implementation](../gateway-implementation.md). Production use is gated on a verified DLF/Jazz-compatible browser identity verifier (G3). No unauthenticated open proxy or invented SDK verifier is authorized.

## POST /api/capture/resolve

Input JSON: `{protocolVersion: 1, operationId, url}`. Accept exactly one HTTP(S) URL, no embedded username/password, bounded 8 KiB URL, authenticated owner session. No arbitrary upstream headers or cookies. Returns `{operationId, submittedUrl, finalUrl, redirects: [{from,to,status}], canonicalCandidate?, resolvedAt, fetchCapability?}`. An opaque short-lived fetch capability is owner-bound and does not bypass revalidation. First-party runtime may combine resolution/fetch internally to avoid inconsistent destinations.

## POST /api/capture/extract

Input: `{protocolVersion: 1, operationId, url, resolutionId?}`. Resolve/revalidate public destination, fetch bounded document, parse inertly with a server-compatible DOM, run the chosen extractor/sanitizer and return `{finalUrl, provenance, candidate: {title,author?,html,text,headings,footnotes,assetCandidates,parserVersion,normalizationVersion,partialEvidence}}`. Client validates schema, size and sanitizer contract before persistence. Keep the complete JSON response below 5 MiB to allow Netlify buffered-response overhead; oversized extracted output returns 413 rather than an unbounded response. Response is a capture candidate, not proof of a locally saved document.

Initial limits: 8 redirect hops, 20-second upstream total budget within function budget, 10 MiB decompressed HTML, bounded compression ratio/stream consumption. Parse supported text/HTML only. These limits need representative fixture validation, not unrestricted upstream reads. Public gateway does not bypass logins/paywalls; extension captures authorized rendered content instead.

## POST /api/capture/asset

Input: `{protocolVersion:1,operationId,sourceUrl,documentSource}`; authenticated and linked to a legitimate capture/document context. Enforce the same per-hop network validation. Return a buffered image of at most 4 MiB plus verified media type, final source URL and size; larger gateway images fail explicitly (the direct permitted extension path may accept its separately bounded input limit); client processes it in image worker. Reject HTML disguised as an image and active SVG for inline persistence unless an explicit safe rasterization path is qualified. No general file-upload endpoint is selected.

## Network and authorization requirements

- Verify owner session/server token without accepting an account ID as authentication. Current DLF session capability does not itself define an HTTP verifier; design/prove the exchange before enabling endpoints.
- SDK source review found the public `resolveRequestSession` and `isRequestAuthenticationError` exports in `jazz-tools/backend`. They are the verifier candidate, not a missing API to reinvent. Configure the correct app ID and canonical account registry; signature-only standalone resolution is insufficient for the deployed owner binding. Local-first proof acquisition from the trusted client and the verifier's `jazz-napi` dependency in Netlify still require qualification. Authentication failures map to 401; registry/configuration outages remain server failures (503), not a request to create another identity. Never use internal token helpers or export recovery secrets to obtain a bearer token.
- Subsequent isolated browser qualification succeeded using the managed session's current `Db.getConfig().jwtToken` in a trusted request leaf and the public server verifier; tampering returned 401 and a valid token resolved the same account. Dedicated `getLocalFirstIdentityProof()` returned null on this managed-session path. Select the current-token compatibility adapter for alpha.59: copy only the bearer into the fixed first-party request, never retain/log/send the whole configuration, and invalidate stale account-bound results. Linux native packaging/deployment and full endpoint authorization remain gates. See [investigation results](../investigation-results.md).
- Allow HTTP(S) public internet only. Resolve all addresses, reject loopback/private/link-local/reserved destinations, pin/validate the connection against the checked destination, and re-check every redirect including cross-origin transitions. Reject prohibited ports and local metadata endpoints. If platform networking cannot enforce this, use a qualified first-party fetch service or fail G3; DNS preflight alone is insufficient.
- No credential forwarding, upstream Authorization, arbitrary request methods, environment access, browser cookie exports, private content logs, or unbounded response proxying.
- HTTPS same-origin requests with secure session/CSRF protection as appropriate; extension origins require explicit authorization rather than wildcard credential CORS. Apply per-owner concurrency/rate limits; retries respect Retry-After.
- Responses are `Cache-Control: private, no-store`; never put private content into shared CDN caches or general service-worker caches. No server-side long-term article store or content telemetry is introduced.

## Outcomes

200 yields a validated candidate; 400 input failure; 401/403 owner/session failure; 409 stale resolution/request conflict when relevant; 413 source/asset exceeds limits; 415 unsupported media; 422 no usable content with link-only fallback; 429 bounded retry; 502/504 upstream unavailable/timeout. Payloads contain stable error code and retryability, not raw upstream credentials or stack traces.

Domain idempotency lives in the account-scoped capture journal and repository commit. Repeating a read-only upstream fetch is allowed; repeating a document insert after uncertain commit is not. Gateway responses do not select the canonical library document or replace a saved snapshot.
