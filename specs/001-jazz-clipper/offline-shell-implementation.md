# Offline application startup

DLF continues to own Jazz acquisition, readiness, recovery and teardown through its packaged public exports; Clipper adds no account/session/storage implementation. The current DLF package has no service-worker or asset-cache API. Clipper therefore owns its SvelteKit build manifest, public app-shell policy and browser registration integration. UI actor teardown reuses DLF's `stopAfterShutdown`.

A prerendered, account-independent root shell and build-generated public assets are precached. No authenticated API responses, Jazz requests, credentials, recovery phrases or article records enter Cache Storage. Jazz retains private records in its existing owner-scoped persistence. Known runtime version query parameters resolve to the matching immutable public asset, rather than storing another WASM copy.

Install owns cache creation → bounded build asset population → failed-install cleanup. Activation removes only obsolete Clipper shell caches and claims clients. Immutable bytes may be reused across builds; the root HTML is always fetched anew. Failed population drains its issued work before discarding the new cache. Readiness is shown only after successful activation; first session acquisition waits for installation to avoid fetching WASM twice, with an explicit online-only fallback if caching is unsupported or fails.

Updates use the browser's waiting-worker lifecycle: no skipWaiting and no forced reload. An installed update is advertised; it activates when all older app tabs close. Old caches survive until activation, so old tabs retain their matching assets. This avoids replacing an active app or interrupting issued writes.

Qualification must use production builds, clear HTTP cache, stop both static web and Jazz servers, close the entire browser process, reopen the same profile and read exact locally saved content. Separately restored-profile sync, failed installation, update waiting/cache cleanup, private request exclusion, exact runtime assets and startup/download measurements are checked independently. Browser cache eviction or cleared site data can remove offline availability; no universal persistence/platform claim follows from a Chromium test.


Validation: `pnpm verify` passes with 203 tests across 24 files, including separate service-worker TypeScript checks. All eight existing Chromium integration tests and five production offline tests pass. CI runs both browser suites. The new production tests build two real versions and run actual Jazz servers; only upstream extraction responses are fixtures. They verify that first-install failure allows the normal DLF account path, and retry prepares the cache without replacing that account.

Observed local Node 24/Chromium runs: first shell preparation 222–256 ms; reader available after offline browser-process restart 493–496 ms. Exactly one 19,342,148-byte WASM response was transferred during successful initial startup; the next build reused that immutable binary without a new transfer. These are localhost observations, not network/device performance guarantees. Each production client output contains one WASM file. Current UI fonts are system fonts; bundled static font assets would be included in the same public allowlist.

The capture-enabled boolean is now a public build-time flag, removing the server layout-data request from cold boot. It is not authentication: the gateway still requires Jazz/DLF bearer verification and registry admission. Production's disabled default is retained. No DLF source or package changes were needed: the shipped public session/startup/readiness/recovery and lifecycle exports are reused, while build-specific caching remains application-owned.


Network asset fetches have a 30-second deadline, and the first-install session-admission gate falls back after 45 seconds rather than blocking DLF acquisition indefinitely. Redirected/non-public responses and HTML fallbacks masquerading as JS/CSS/WASM are rejected. The normal DLF account actor stays mounted during cache retries and update observation.
