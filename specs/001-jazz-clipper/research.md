# Technical research and decisions

**Date**: 2026-11-02 · **Status**: design decisions selected; browser/device and integration proofs pending.

## R1 — Rewrite baseline and packaging

**Decision**: replace the old application foundations during implementation; adopt strict TypeScript and the sibling Svelte 5/XState 5 baseline. Keep app/extension/shared contracts in one pnpm workspace. Pin Jazz to `2.0.0-alpha.59` and Svelte/XState to the DLF peer contract until an intentional upgrade is qualified. SvelteKit 3/Vite 8 are candidate peers, not installed here.

**Evidence**: Clipper `package.json` contains Svelte 3, TypeScript 4.6, XState 4, Webnative and `next` Kit/adapters. DLF `package.json` pins Svelte 5.57.2, XState 5.33.2, Jazz alpha.59 and pnpm 10.22.0; DUI's peer requires Svelte ^5.57.2; Finance consumes Kit ^3.0.1. Their local manifests are version evidence, not proof of Clipper build compatibility.

**Alternatives**: incrementally retain Webnative (rejected by accepted rewrite direction); separate extension repository (extra schema/message drift); introduce a browser-extension framework immediately (not necessary to decide capture contracts).

Current Kit docs place adapter configuration in Vite for Kit 3, so do not copy older adapter setup verbatim. [SvelteKit adapters](https://svelte.dev/docs/kit/adapters). Validate production adapter output before deleting the prototype.

## R2 — Identity and persistence are real integration boundaries

**Decision**: import DLF session/recovery/restoration granular entry points and place Clipper data access behind typed capabilities. No new account recovery or reuse of Finance domain schema.

**Local evidence**: DLF `src/lib/backend/jazz/session.ts` calls `createJazzSession`; `src/lib/contracts/session.ts` makes scope generation and nonserializable session payloads explicit. DLF root `src/lib/index.ts` is empty. Session/recovery/readiness/workspace selection exist, but package publication, private-library provisioning, and extension device linking are not established as a complete service. See the sibling `AGENTS.md` and `.specify/memory/xstate.md` for integration constraints.

**SDK verification**: the installed alpha.59 package at `/Users/matt/Projects/delightful-finances/node_modules/jazz-tools` matches the pinned version. Its `dist/runtime/client.d.ts` defines `WriteHandle.wait({tier: 'local' | 'global'})`; an immediate row value is not durable completion. `dist/session/state.d.ts` exposes `restoreLocalFirst(secret)`, not a serializable AccountHandle bridge. Current web documentation may evolve; the installed signatures are the selected compatibility evidence. [Writing data](https://jazz.tools/docs/writing/writing-data)

**Alternative**: old Jazz CoValue/FileStream examples are not assumed compatible with the table-oriented alpha.59 APIs.

## R3 — Byte-part assets and derived local indexes

**Decision**: store immutable sanitized snapshots and compressed image payloads as owner-scoped rows/byte parts; stage all parts durably before exposing a complete manifest. Keep a device-local availability ledger. Treat missing bytes as missing, not as online-readable proxy URLs.

Finance's `src/lib/schema/attachments.ts` demonstrates `s.bytes()` parts under file metadata; its attachment upload workflow waits for local durability. Reuse the pattern conceptually, not Finance's transaction/account domain. Prefer bounded 256 KiB parts initially and validate overhead. A two-device blob proof and server owner policy remain release gates.

Search uses a per-account MiniSearch worker index, recreated from persisted source rows when stale. The index is a cache, not source-of-truth annotation storage. MiniSearch provides serialization and update/removal primitives. [MiniSearch](https://github.com/lucaong/minisearch)

Browser storage is bounded and may be best effort. Persist requests and quota failures need explicit handling; a denied persistence request must not be presented as a guarantee against eviction. Storage management UI remains deferred. [StorageManager](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager)

## R4 — Source acquisition and extraction

**Decision**: browser extension captures current rendered HTML; Add Link uses a first-party Netlify public-source fetch/extract endpoint. No third-party extraction API or forwarding site credentials. Use Readability baseline; evaluate Defuddle against the same fixtures before changing that choice.

**Rationale**: source availability and browser permissions differ. DOM-based extraction cannot be moved into a standard worker just by importing a library. Raw network HTML needs an HTML parser outside the UI; serialized browser HTML can feed a validated worker DOM adapter. Keep that adapter a proof gate. The image/search pipelines use ordinary dedicated workers independently.

**Sanitization**: inert parse → extract → sanitize → derive normalized text/map; apply an allowlist at the rendering boundary. Block scripts, active embeds, event handlers, unsafe schemes and live remote resource loads in the saved reader. Derive text/anchors from the final normalized representation. Do not pass DOMPurify an arbitrary worker DOM and assume browser-level safety.

**URLs**: retain submitted URL, redirect provenance, final destination and canonical candidate separately. Server fetch validates every hop, address resolution and final peer; reject private/reserved addresses, credentials, invalid schemes, over-limit redirects, timeouts and huge bodies. Accept canonical alias only with verified equivalence; never strip unknown query/route information. Origin credentials remain confined to browser capture.

## R5 — Snapshot identity and exact anchoring

**Decision**: one immutable successful article snapshot; separate source/reader selector bundles under the same annotation. Build a versioned plain-text projection and code-point-to-DOM mapping from sanitized content. A DOM or text-position fast path is accepted only after quote verification. Exact quote fallback must enumerate candidates with prefix/suffix context; multiple plausible matches stay ambiguous. No fuzzy candidate generation/repair UI in launch scope.

**Rationale**: the Readwise/Hypothesis investigations in [spec.md](spec.md) show why positions alone cannot cross representations and why best-scored approximate matches can misattach. W3C code-point offsets and browser UTF-16 offsets require explicit conversion. Keep the original quote/selectors and resolution status even when mapping fails.

**Alternatives**: copy Readwise first-match fallback (insufficient disambiguation); implement Hypothesis approximate matcher/repair screens immediately (outside reduced scope); adopt full RDF/JSON-LD storage as the internal database (unnecessary for compatible selector semantics).

## R6 — Session ownership and extension composition

**Decision**: separate trusted extension UI session, restored via the DLF recovery flow to the same account. No automatic credential transfer in the initial architecture. Background/content contexts exchange validated typed requests and durable pending-intake identifiers, not root secrets. Capture may be pending until the trusted session runtime is available; user-facing status states that honestly.

**Gate**: prove alpha.59 WASM/CSP and browser persistence work in packaged Chrome/Firefox extension origins. If a persistent trusted page or linked-session strategy cannot satisfy capture completion, revise this design before implementing extension-dependent screens. Do not keep workers alive with unsupported timing tricks.

**Alternatives**: session state in content scripts (rejected); generic device-link protocol invented inside Clipper (violates DLF ownership); assume web and extension origins share IndexedDB (false).

## R7 — Localized, offline-capable presentation

**Decision**: one i18next instance per app runtime; one Svelte-readable locale/resource readiness binding, bundled English catalogs shared by app/extension. Translate message descriptors at presentation. Do not import DLF's Paraglide catalog as if it were Clipper's i18next catalog; define a boundary for DLF-owned copy. SSR has request-local instances if added; private library is client-rendered initially.

**Evidence**: i18next exposes `createInstance`, initialization and `languageChanged`; a small Svelte integration avoids requiring an unverified wrapper. [i18next API](https://www.i18next.com/overview/api)

**Shell**: cache only versioned static assets and safe navigation fallback; do not cache auth/fetch endpoints or arbitrary private responses in a general cache. The legacy service worker is not reused. Upgrade without discarding durable data. [SvelteKit service workers](https://svelte.dev/docs/kit/service-workers)

## R8 — Remaining validations versus unresolved product choices

No new product features are requested. Selected designs have explicit implementation gates: DLF packaging/provisioning, gateway auth, extension runtime, worker DOM equivalence, assets/local-tier durability and real-device support. Their proofs are not complete, so research is not reported as an implementation-readiness pass. Clipper has no adopted constitution or local Spec Kit script; plan artifacts are manual/provisional and no hooks exist to run.

## R9 — Browser support and extraction evidence

**Decision**: Chrome desktop extension and Firefox/macOS extension are targets with separate background adapters. Chrome Android supports installed-PWA URL/text share intake; iOS Safari uses Add Link. Minimum supported versions are provisional until physical-device validation; this research does not qualify them. Do not confuse outbound Web Share with inbound Share Target. [Chrome share target](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target), [WebKit implementation issue](https://bugs.webkit.org/show_bug.cgi?id=194593)

Chrome MV3 service workers can be suspended, and Firefox background scripts have different support. Durable intake/checkpoints are required; an open popup is not a job host. Cross-origin reads belong in permitted extension privileged contexts, not ordinary content-script fetch. [Chrome lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [Firefox background manifest](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background), [extension network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)

Readability's JSDOMParser explicitly supports workers but requires properly formed serialized markup. Raw fetched malformed HTML goes through inert jsdom on the server. DOMPurify requires a suitable maintained DOM implementation; worker extraction compatibility does not imply sanitizer safety. Defuddle remains a comparison candidate; disable asynchronous external extraction (`useAsync`) if evaluated. [Readability worker parser](https://raw.githubusercontent.com/mozilla/readability/main/JSDOMParser.js), [DOMPurify](https://github.com/cure53/DOMPurify), [Defuddle](https://github.com/kepano/defuddle)

**Platform constraints**: current Netlify documentation gives a 60-second synchronous function limit and 6 MB buffered payload limit. Application responses must fit below those limits even if upstream HTML is larger; use a 5 MiB JSON response ceiling and reject oversized output. A source fetch that works locally is insufficient qualification for deployed transport/address validation. [Netlify function configuration](https://docs.netlify.com/build/functions/configuration/), [SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)

**Alternatives**: direct PWA fetch alone (insufficient cross-origin coverage); unauthenticated proxy (not acceptable for private capture or bounded upstream access); assuming iOS share-target parity (unsupported); implementing a new third-party extraction backend (not authorized).

## R10 — Additional local evidence and dependency constraints

- Installed alpha.59 `dist/accounts/create-account-manager.d.ts` defaults browser credential persistence to origin-scoped localStorage. A trusted extension page can use restoration, but browser storage is not automatically shared with the PWA.
- `dist/accounts/persistence.d.ts` requires atomic, durably completed custom AccountStore updates across managers. A naive chrome.storage get/set adapter is not a proven implementation.
- Finance `src/lib/machines/transactions/attachments/transaction-attachment-upload.ts` demonstrates staged 256 KiB byte parts and local durability waits. `src/lib/permissions.ts` demonstrates parent-derived file/part authorization. Clipper must implement its own domain relationships and qualify the resulting policy.
- DLF `src/lib/backend/jazz/recovery-phrase.ts` and `restoration.ts` implement recovery/restoration leaves; published/packed subpath delivery remains a gate. Pin vendor tarball/commit hashes as well as semver strings.
- DUI exposes Dialog/Popover/status/input primitives; neither an image viewer nor preset manager needs to be built under this reduced Clipper scope. DLF recovery message props can receive i18next-translated messages; its own internal Paraglide use does not require replacing Clipper's selected localization direction.

## Spec Kit completion audit

The pre-plan setup command could not run because `.specify/scripts/bash/setup-plan.sh` does not exist in Clipper. The local constitution and `.specify/extensions.yml` also do not exist. No pre/post hooks were registered or executed. This pass produced provisional Phase 0/1 artifacts manually using the sibling template structure. The skill requires no unresolved gate failures before claiming completion; G1–G5 remain open, so full workflow completion is not claimed. The next step is resolving those integration proofs, not generating an implementation task list as if readiness had passed.

## R11 — Request authentication candidate and creation qualification

Further installed alpha.59 source review found public `resolveRequestSession` and `isRequestAuthenticationError` in `jazz-tools/backend`. The implementation verifies local-first proofs through `jazz-napi`, can admit them through a configured canonical account registry, and distinguishes credential rejection from registry/configuration failure. A standalone signature-only path without the registry exists; it is not sufficient evidence of Clipper's deployed account authorization. Trusted-client proof acquisition, native module packaging on Netlify and end-to-end owner binding remain G3 qualification. This narrows the gap: a verifier candidate exists, but the complete request-auth bridge is not established.

DLF's private creation and Jazz mapping notes now document real transaction APIs and uncertain-commit recovery gaps. Exclusive `wait()` uses global confirmation with an authority configured and local confirmation otherwise. Exported fate types do not establish an inspected public historical-fate query. Do not label local-only exclusive confirmation server acceptance or interpret an incomplete replica's missing operation marker as failed-before-commit. See the sibling foundation's `workspaces/private-creation.md` and `workspaces/jazz-creation-mapping.md`.

## Specification completion disposition

The product specification and launch interaction defaults are now consolidated. Deferred questions remain outside MVP. Product completion is not full technical-plan completion: package/runtime/security/device gates require implementation or deployed qualification that was not performed in this specification phase. No task list, code migration, deployment or test result is implied.

## R12 — Investigation closure and narrower first implementation

The [investigation results](investigation-results.md) supersede earlier unknowns with executed evidence: packaged DLF public adapters, browser/Chromium-extension local string/byte persistence after page close with authority stopped, same-account recovery across origins, current managed-bearer verification, production-style local WASM packaging, synthetic parser/search/localization checks, and canonical-root authority policies. No user library or production app was changed.

Earlier planning over-gated Clipper on generic DLF multi-workspace creation. Clipper's app-owned canonical immutable root can use account UUID identity and owner-bound write policies; repeated identical ensure is distinct from unsafe replay of domain writes. The [selected bootstrap](contracts/library-bootstrap.md) and [first implementation handoff](implementation-handoff.md) replace that dependency without adding workspace UI or relaxing privacy. Independent offline replica convergence remains acceptance work.

Two negative findings change implementation: the managed-session dedicated proof API returned null (current public config bearer verified successfully through a narrow trusted leaf); default Vite extension output missed the SDK's root WASM path (explicit local asset inclusion fixed startup). Readability also dropped a referenced footnote target, requiring pre-extraction preservation and final text projection afterward. See the result report for versions, limits and primary documentation.

The first bounded implementation is ready. Full release/runtime gates remain, including Node 24, Linux Netlify native/network validation, complete PWA offline/process restart, actual extension background capture, Firefox/mobile and representative anchor quality. These require production artifacts and do not justify an endless preimplementation investigation loop. No full Speckit all-gates completion is asserted.
