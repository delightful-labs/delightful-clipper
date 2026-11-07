# Worker-owned application runtime

The user's standing architecture requirement is a UI-only main thread. Non-UI application state, data access, validation, persistence, hashing and projections belong in workers. Deferring/caching main-thread work does not satisfy this requirement.

The reference is Comlink and Surma's off-main-thread state-management architecture, used by PROXX/Squoosh. This implementation retains Clipper's typed messages and XState owners; no new RPC dependency is required. Commands and bounded render-ready data cross the boundary, not SDK objects, actor snapshots, transaction handles or DOM nodes.

## Account-store ownership

The worker reuses DLF/Jazz's account selection behavior and exact existing localStorage namespace. No identity or database namespace is reset or migrated. The SDK's browser-runtime detection admits a WorkerGlobalScope as well as a Window through a narrowly scoped patch to the existing pinned SDK.

`accountStoreUpdateMachine` in the worker acquires the same Web Lock as the existing SDK store, reads the existing selection, invokes the SDK-provided synchronous transform, writes the replacement and waits for lock release. Read/transform/write failure releases the lock before reporting failure. An issued write is awaited; stopping an observing UI is not write cancellation.

The Window compatibility adapter performs only getItem/setItem on one fixed private-port-bound key. localStorage has no worker API. Identity rules, transforms, locking and sequencing stay in the worker. Credentials and account-store replies must not enter render DTOs or diagnostics. A future change to the persistence medium must preserve existing identities and concurrency with old tabs.

## Application boundary

The application worker will own account/readiness/bootstrap, the domain library and its transaction/save/search/image/data actors. UI clients send intent and receive serializable render projections with account generation and request identity. DOM/fullscreen/selection/viewport resources remain UI-owned and expose narrow, scoped native-effect adapters. Shutdown must drain issued domain writes and native UI leases before acknowledging completion; unknown writes are never blindly replayed.

Qualification starts with the actual patched SDK in a real dedicated worker: open an existing Window-created identity, read and write its existing persistent library, close the worker and reopen the Window client without losing data. This evidence is required before routing production UI through the worker host. Unit tests of transport alone do not qualify native persistence.

## Native broker construction

Chromium does not expose the SharedWorker constructor inside a dedicated worker. The pinned SDK patch adds an explicit `browserWorkerHost` capability: construct a broker by its exact resolved URL/name, and read/write its existing generation key. The Window adapter transfers the native port immediately. It does not run the broker protocol, choose generations, acquire account locks, initialize WASM or touch the database. The SDK still owns admission, lease retirement and closing-realm handling. Live host functions are excluded from broker configuration messages and `Db.getConfig()` clones. The existing Window SDK path remains supported.

Connectivity adapters accept WorkerGlobalScope events. Shared logging/fake-data flags use Vite's public build-time environment so application-worker imports do not require SvelteKit's Window environment bootstrap.

## Current implementation and qualification

`application.worker.ts` runs the existing DLF-backed application-readiness/root-bootstrap and domain library actors in a dedicated worker and emits at most 50 row headers per render message. `workerHostMachine` owns the realm shutdown: drain the application, obtain the retained DLF acquisition (including a late SDK open), close the native session, then acknowledge `CLOSED` and release private ports. An application cleanup/owner failure or SDK close failure refuses that acknowledgment. The retained acquisition owner is stopped only after successful close.

Run `pnpm test:worker` for the isolated Chromium integration. It qualifies first-use local account/library creation without a Window application, existing-account and existing-library reuse, the actual article save machine (including preparation/hashing) in a worker, an acknowledged local worker write still readable after Window reload with network disabled, real application/library startup in the worker, and shutdown requested while acquisition is pending. Native Web Lock tests cover competing transforms and read/transform/write failure without replay. These are Chromium development-worker tests; they do not establish all-browser or packaged/offline-worker support.

The production Svelte UI has **not yet switched to the new application worker**. The entry currently supports initialization, account intent and shutdown; library/reader commands and the complete render protocol remain to be connected. This foundation therefore makes no claim of a production startup-speed improvement or completion of the UI-only-main-thread migration.

The next implementation boundary is the UI client and account-generation-scoped library commands/render views, followed by reader DOM/fullscreen/viewport ports, recovery presentation and worker-owned form/draft validation. Preserve the existing reader drain acknowledgments and transaction outcomes through that cutover. Qualify the actual production worker bundle and offline direct-reader loads before enabling the new path. Port failure/timeouts and explicit retry/reconnection also need to be settled in that client lifetime owner.

References: [Comlink](https://github.com/GoogleChromeLabs/comlink), [Surma's worker-owned state example](https://surma.dev/things/react-redux-comlink/), and [off-main-thread architecture](https://web.dev/articles/off-main-thread). No new third-party package was installed.

Validation for the foundation: `pnpm verify` passed (657 tests, 1 skipped, type/lint/format/vendor checks and production build); `pnpm test:worker` passed 4 Chromium tests; `pnpm test:offline` passed 5 production offline tests. No production-worker startup timing has been measured. The existing production build still reports its large-chunk advisory. This branch is based on startup PR #22; it does not merge that PR.
