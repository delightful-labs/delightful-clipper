# Worker-owned web application runtime

The user's standing requirement is a UI-only main thread. Application/domain state, Jazz access, validation, persistence, hashing, projections and search preparation belong in workers. Deferring or caching main-thread work does not satisfy that boundary.

The reference is [Comlink](https://github.com/GoogleChromeLabs/comlink) and [Surma's worker-owned state example](https://surma.dev/things/react-redux-comlink/). Clipper retains typed messages and XState owners; no new RPC dependency is installed. Commands and explicit render projections cross the boundary, never SDK objects, actor snapshots, transaction handles or DOM nodes.

## Production ownership

The alpha.60 migration adds a local-first preparation state before library bootstrap. A thin client is not evidence that local storage is ready. The worker invokes the SDK upgrade, refreshes its observation after settlement, and drains an in-flight upgrade before acknowledging shutdown. An upgrade failure leaves the library unavailable instead of opening it against the thin client.

Unexpectedly stopped transaction owners transfer their native acquisition, pending call, and commit receipts into private worker-realm custody. These receipts are never projected into UI messages, automatically replayed, or assumed safe to roll back. Retained custody blocks the worker host's clean-close acknowledgment; ordinary graceful shutdown still drains through the existing transaction owners.

The web layout mounts `Application.svelte`, whose native port client opens `application.worker.ts`. That worker owns the existing DLF account acquisition/readiness/restoration, root bootstrap, domain library, save/organization transactions, recovery workflow, tag validation, data subscriptions and projections. Capture network/database calls execute there; search, article coordination and image processing retain their nested workers. The main thread renders DUI components, forwards intent, and owns DOM, focus, selection, layout, scrolling and fullscreen effects.

The web UI no longer opens a Jazz session or constructs the application/library actors. Browser test fixtures which require direct SDK access explicitly import `tests/fixture-records.ts`; that Window client is test-only and is not imported by the production UI. Extension settings and sign-in also use dedicated workers through the same host, with the extension's existing library capability. Chrome connection confirmation stays behind a Window-only native adapter; its sign-in chart runs in the worker. The hidden offscreen capture runtime retains its existing ownership, so this is not a claim that every extension workflow has migrated.

## Native compatibility adapters

localStorage and Chromium's SharedWorker constructor require a Window bridge. The account-storage port performs getItem/setItem on one fixed worker-selected key. The broker port constructs the SDK's exact resolved URL/name and transfers its native port; it also reads/writes the SDK's existing generation keys. No account policy, WASM initialization, database operation, broker admission or generation selection executes in those adapters. Window online/offline events are forwarded as native facts because dedicated-worker connectivity transitions are unreliable in Chromium. Worker charts own the resulting status, admission and retry decisions.

The existing account selection key and physical database namespaces are preserved. `accountStoreUpdateMachine` holds the same Web Lock as the existing SDK store, invokes the SDK transform in the worker, awaits its write acknowledgment, and releases the lock before settling. Failure does not replay an update. Identity data and storage replies stay off the render channel.

The pinned Jazz patch admits dedicated-worker browser runtimes and accepts the explicit native broker host. Host functions are stripped from broker messages and `Db.getConfig()` clones. Existing Window SDK clients remain supported. The DLF patch exports its existing presentation-only recovery component and fixes its generated declaration's type-name collision; identity/recovery behavior is reused unchanged. Original vendor archives are unchanged and verified.

## Scoped intent and bounded views

The host chart owns a fresh binding token for each library attachment. Account, library, tag and recovery admission checks that token; library operations retain their native `isCurrent` and transaction guards. A reader surface must also match the currently opened document snapshot. Old UI references cannot retarget a replacement library. Request receipts acknowledge dispatch only, never local durability or remote acceptance. UI controls wait for that receipt and then follow the domain machine's actual save state. No transport retry silently reissues a mutation.

Default row projection is 50 headers; the worker expands it on explicit Show articles intent and resets it on filter/query changes. Search still covers the full collection, but its internal result IDs and full corpus do not cross into the UI. The selected tag-editor header is projected separately so an open dialog remains usable when its article stops matching a filter. Reader views contain only the selected content/render fields; immutable revisions send article bytes once per binding and preserve the UI's existing DOM, focus and selection through status updates. Only the current reader's progress is included. Vocabulary is sent once per view rather than duplicated in every row.

Recovery is a host-owned child wrapping DLF's existing phrase chart and scope observation. Its sensitive view uses a separate message variant, never the ordinary render DTO. Sensitive actor state/output is excluded from diagnostics. UI detach/failure stops render and recovery delivery, clears the displayed phrase and exposes the existing reload action. Failed transport does not claim rollback or retry unknown writes.

## Reader surface lifetime

The worker's reader chart owns reading preferences, progress, persistence, focus-mode decisions and shutdown. A surface port exposes only native fullscreen facts/effects and the UI viewport actor. The viewport actor reads layout and text-node geometry, restores scrolling and reports measured anchors; it has no database capability. Image references are read from rendered DOM attributes and validated/decoded in the worker, without serializing the whole article DOM back to it.

UI release immediately detaches the native viewport while its DOM is still present. Its final-position acknowledgment crosses the surface port; the reader chart drains the resulting writes and fullscreen exit before completing. A late viewport-open request for an already released DOM lease acknowledges closure without recreating the resource. Worker/SDK termination never substitutes for that acknowledgment.

`workerHostMachine` drains the application, waits for retained DLF acquisition (including a late SDK open), closes the actual SDK session, and only then emits `CLOSED`. Cleanup/owner/close failures refuse safe-termination acknowledgment. The UI port terminates its worker only after that receipt. Unknown-write settlement and reconciliation remain with the existing DLF/domain charts.

## Qualification and development

Run `pnpm verify`, `pnpm test:worker`, the web browser suite and `pnpm test:offline`. Worker tests cover first use without a Window app, existing identity/library reuse, actual article preparation/hashing/save, retained local data after reload with network disabled, shutdown during acquisition, zero Window WebAssembly compile/instantiate calls, and stale-binding refusal. Native tests cover account-store concurrency/failures and suppressing render/recovery delivery after UI failure or detach while awaiting safe worker close.

Production offline qualification exercises the built application worker, cold browser/reader restart with both servers stopped, image/organization/search persistence, update cache behavior, and one WASM binary per build. Cache-failure injection distinguishes install-time cache fetches from live worker-script requests: denying an essential application worker is a runtime failure, not merely an unavailable offline cache.

Worker-only runtime dependencies are prebundled for development so first activation cannot trigger a late Vite reload. Worker qualification uses a separate generated Kit output directory. Do not run builds/type generation concurrently with a browser suite against the same worktree. Preserve unrelated servers; isolated qualification can remap test ports without changing their product behavior.

No post-cutover startup latency improvement is claimed without a comparable benchmark. Zero UI-thread WASM initialization and the worker ownership boundary are qualified separately from elapsed startup time. The branch includes startup PR #22 but does not merge it.

Alpha.59 baseline web-cutover qualification (the alpha.60 migration must repeat these checks): `pnpm verify` passed with 659 tests and one platform skip, including vendor/format/lint/strict types and the production build. A frozen-source full web run passed all 62 cases, including Chromium and Firefox schema upgrades. Six Chromium worker cases, the Firefox UI-thread WASM case, five production offline cases, two sample-data cases and eleven packaged-extension cases passed. Isolated copies remapped browser test authorities to free ports; product code and assertions were retained. Production builds retain the existing large-chunk advisory. No production latency comparison was performed for this cutover.

Alpha.60 integration evidence (2026-11-07): actual Chromium Add Link fetched and extracted Example Domain (both API requests returned 200), rendered the article, and retained it after reload. The same run observed zero Window WASM initialization calls and two dedicated workers. This does not replace production offline, extension, or latency qualification.

The alpha.60 compatibility patch additionally removes live host callbacks from SharedWorker WASM prefetch metadata. Guest capture admission uses `accountFor`, with the SDK's sync signature/audience verification and a fresh read-only authority registry resolution. It never creates accounts or exposes a backend database for guests; malformed, forged, expired, foreign-scope, unregistered and revoked proofs are denied. Production proof audiences are restricted to Vercel-provided deployment URLs. A custom domain will require an explicit allowlist addition before cutover.

Development sockets and SvelteKit HTTP routes must load the backend through `server.environments.ssr.runner`, after the server's listening event. Vite's legacy `ssrLoadModule` creates a separate module graph and therefore a separate in-memory authority. The startup chart waits for listening and drains acquisition/attachment on close. Backend definition changes restart the complete server rather than hot-replacing one authority.

Alpha.60 follow-up qualification: the full native/unit suite passes with 670 tests and one platform skip across 98 files. Web, extension and service-worker types, lint and formatting pass. Five production offline browser cases pass with a real persistent SQLite `createJazz` backend, including cold browser/reader restart with both servers stopped and HTTP cache cleared, later restored-profile sync, update safety, and one WASM binary per build. The traced Vercel parser worker also executes successfully from its actual function artifact. A production latency comparison and packaged-extension alpha.60 qualification remain pending.

Historical migration fixtures retain their assertions and transformations but use the alpha.60 backend for guest admission, a stable application endpoint across reopen, and explicit connected client migration bundles. Alpha.60's structural hashes are resolved using its own SDK implementation. These tests establish the historical transformations and persisted-replica behavior within alpha.60, not a direct alpha.59 database-file upgrade; the approved Finance cutover requires backup restoration into a fresh target.

All six dedicated-worker browser cases also pass on alpha.60: existing identity/library reuse, worker-only first use, real domain writes, startup/acquisition shutdown draining, zero UI-thread WASM initialization, and stale-binding refusal. Qualification drivers resolve the current endpoint through the same test helper and use the current shared account-storage namespace. The development backend owns the worker suite's same-origin authority; a second unused test core is unnecessary.

Alpha.60 release checks (2026-11-07): `pnpm verify` passes with 677 unit/native tests and one platform skip across 98 files. All 54 main web cases and eight Chromium/Firefox historical-schema cases pass; the affected 21 account cases and six worker cases were repeated after the recovery readiness correction. Five production offline cases and two sample-data cases pass. Eleven packaged Chromium cases pass, including offline restart and private restored reading. A live Vercel build passes resolve/extract (200), reader reload and zero UI-thread WASM loads; the packaged extension separately restores a synthetic web account, saves via the real toolbar and syncs to a reader that survives reload. No production latency comparison was performed.

Recovery presentation follows the ready library invocation lifetime and is withdrawn during drain. Extension UI bindings retain immutable XState snapshots with `$state.raw`. Chrome can resolve offscreen creation before its ESM message listener is installed: the launch chart retries only read-only authorization transport errors for a bounded startup window. Explicit account refusals and issued article writes do not use that retry path.

Extension settings/sign-in follow-up (2026-11-10): preserve Jazz alpha.60's
existing extension account key and Web Lock name,
`jazz-account-selection-v1:<registry>:clipper`. Use Jazz's public
`accountRegistryUrl` and its endpoint scope; keep Jazz's selection representation
and transforms. The web worker's existing v2 endpoint key is unchanged. Native
SDK/worker round-trip tests cover saved-account reuse in both directions. Moving
the extension UI onto the web worker's v2 key strands its offscreen account owner
on another selection and must not be repeated. Explicit popup close waits for
the shared host's native session-close acknowledgment. See the dated
[startup investigation](../reviews/extension-startup-2026-11-09.md) for bounded
macOS teardown evidence and remaining platform limits.
