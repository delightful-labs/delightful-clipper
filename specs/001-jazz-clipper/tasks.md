# Implementation tasks and acceptance status

Updated 2026-11-05. This is the current implementation checklist; the product requirements remain in spec.md. An implemented capability is not a completed product workflow.

## Current handoff — basic library organization

PR #13 is merged into main at `2cd8731`. The user verified extension sign-in and saving into the web app's library. Basic organization is authorized on `feat/library-organization`, based on that verified current main. Do not merge its eventual PR.

### Basic organization — implemented in PR #14

- [x] Inspect actual native article/content schemas and policies; document the ownership/state model before asynchronous implementation in [library-organization.md](library-organization.md).
- [x] Implement separate status/favorite causal projection, desired-value validation, native owner-scoped operations, local transaction drain and independent remote receipts.
- [x] Add actor-owned status/favorites filtering and native subscription integration.
- [x] Add focused projection, validation, lifecycle/filter/receipt tests and native policy tests.
- [x] Obtain explicit approval for all nine exact catalog additions; the user answered “yes” in this conversation.
- [x] Add DUI status/favorite controls, status views, an AND favorites filter and approved filtered-empty copy.
- [x] Add four real-browser organization cases and extend the production offline-shell restart/sync case.
- [x] Qualify native policies, browser organization, synchronization and offline restart in CI; preserve existing reader/identity/recovery coverage. Local listeners are sandbox-blocked.
- [x] Publish `feat/library-organization` and open Conventional Commits PR [#14](https://github.com/delightful-labs/delightful-clipper/pull/14) targeting main.
- [x] Record final CI evidence: source/build, web, offline and eleven packaged Chromium extension cases pass. Do not merge.

No bulk actions, tags, Trash, search, images or annotations are included. The retained backlog below remains future work.

Current organization evidence: `741844e`, 471 source tests/67 files, 28 application browser cases and five production offline cases pass in [CI](https://github.com/delightful-labs/delightful-clipper/actions/runs/42011312647); all eleven extension cases also pass. The qualified runtime and immutable links are recorded in the handoff.

Historical clipper baseline: URL-first saving and serial missing-content processing remain the web behavior. The Chromium clipper supplies rendered content through the same native save operation, using a trusted DLF session and packaged extraction worker. `pnpm verify` passes 442 unit tests with one platform-specific skip across 63 files, including strict extension checks and the production web build. All 24 web integration tests, five production offline tests and eleven real Chromium extension tests pass sequentially. Current evidence and limitations are in the handoff/tooling documentation.

## Chromium clipper MVP

- [x] Package MV3 Chromium extension with activeTab, scripting, storage and offscreen permissions; restrict storage access to trusted contexts and omit persistent source host permissions/remote code.
- [x] Reuse DLF local-first identity/recovery and common native article save/receipt ownership.
- [x] Bind toolbar capture to source tab/document; reject untrusted senders and navigated documents.
- [x] Serialize an inert bounded page clone and extract rendered content in a packaged worker; share normalized reader text.
- [x] Save directly from toolbar activation using one trusted offscreen runtime; persist bounded source references and never replay uncertain writes.
- [x] Preserve local/remote feedback and duplicate immutability; show an isolated top bar with Open article and Close; dismissal never cancels or deletes native data.
- [x] Keep recovery in trusted Options; drain old-account work before reopening the hidden runtime after restoration.
- [x] Isolate fixture builds in `.test-build` so tests cannot overwrite the installed `dist` extension; confirm checksums remain unchanged.
- [x] Wait for local account readiness before exercising recovery controls; qualify the complete suite in Linux CI as well as locally.
- [ ] Qualify Firefox packaging, store distribution and source annotations in subsequent batches.

## Extension sign-in gate

- [x] Gate toolbar admission on an explicit, scoped account confirmation and the actual SDK account; never treat a silent local identity as sign-in.
- [x] Open a trusted sign-in popup when unconnected; do not capture content or persist article references before confirmation.
- [x] Reuse DLF restoration in XState, persist confirmation only after success and resume the original toolbar gesture.
- [x] Keep invalid/canceled sign-in from authorizing a save, and reject stale account/deployment confirmations.
- [x] Keep connected/offline saves and their existing top bar; preserve web-app no-signup behavior.
- [x] Exercise sign-in into the already-open app account, invalid input, cancel/reopen, stale confirmation and preexisting connected behavior in real Chromium.

## Completed foundation

- [x] Pin workspace tooling and vendor archives; provide build, lint, type-check and test commands.
- [x] Integrate DLF session acquisition/readiness, account creation, recovery and restoration with one runtime owner.
- [x] Implement canonical private library bootstrap with separate local/global settlement and teardown drain.
- [x] Qualify session/root actors, authority policies and Chromium account reload/restoration/offline root restart.
- [x] Add immutable owner-scoped storage operations, native byte assets, text snapshots and document publication records.
- [x] Reuse DLF transaction resource ownership for bounded intent → atomic native snapshot/asset/document publication stages.
- [x] Add bounded domain preparation with operation fingerprints, repository save/read actors and separate remote-acceptance receipts.
- [x] Exercise real-authority native-byte/Unicode round-trip, duplicate operation blocking, account read denial, immutable-row denial, atomic foreign-library rejection, staging invisibility and oversize rejection in repository tests.

## URL-first capture

- [x] Save a native article containing just its URL through the common save operation.
- [x] Accept optional supplied content through that same operation without fetching it again.
- [x] Run capture sequencing in a dedicated module-worker XState machine, one article at a time.
- [x] Keep trusted SDK/authentication resources in a bounded host and drain writes on shutdown.
- [x] Resume missing-content articles after restart; retain URL entries on failure/cancel and Retry the same object.
- [x] Serialize same-profile tabs with Web Locks; retain native uncertain-write non-replay barriers across profiles.
- [x] Reuse immutable existing content and approved catalog copy.
- [ ] Future qualification: full backoff policy, comprehensive failed-redirect provenance and broader platform/deployment coverage. These are not prerequisites to reviewing PR #13; do not turn them into an unsolicited hardening batch.

## Storage qualification before enabling a product write flow

- [x] Remove the redundant custom manifest/part codec; validate native asset bounds and parent consistency.
- [x] Clear retained read-actor content/output at terminal states and qualify scope loss at document, snapshot, asset and optional-source completions.
- [x] Qualify parent-reference consistency and missing/invalid native assets while preserving readable text.
- [x] Exercise shutdown during acquisition/commit/local wait, unknown settlement without replay, and late remote rejection; treat missing stage output as unknown.
- [x] Save unuploaded text/bytes with the authority stopped, close the complete browser process, reopen the same profile and verify exact local content.
- [x] Reconnect and verify that content in a separately restored account profile.
- [x] Wire runtime-owned Add Link/save/read actors and drain local writes before logout, replacement and shutdown.

## Gateway foundation

- [x] Add authenticated, bounded resolve/extract endpoints with public-address pinning and redirect revalidation.
- [x] Add inert Readability extraction, explicit DOMPurify allowlists and referenced footnote preservation.
- [x] Qualify local transport/cancellation/address/sanitizer fixtures and a live authenticated public HTTPS extraction.
- [x] Qualify Netlify native verifier packaging, public extraction/redirects and direct private-address rejection through CLI-driven hosted tests. Production gateway stays disabled; controlled hosted private-redirect fixtures remain a release check.

## Subsequent product and release work

- [x] Build authenticated Add Link → automatic local save → saved reader, with final-destination duplicate checks, provenance and honest remote status.
- [x] Render saved HTML structure with a shared sanitizer allowlist, isolated internal anchors, normal same-tab article links and literal-text fallback; qualify offline restart and restored-profile rendering.
- [ ] Complete image acquisition and richer saved reader requirements. URL articles now persist before fetching; full retry scheduling remains open.
- [x] Implement Chromium direct capture with sender/document validation, packaged runtime assets, native save ownership and restart non-replay.
- [ ] Add Firefox packaging/lifecycle evidence and source/reader annotation anchoring; neither follows from the Chromium capture proof.
- [ ] Implement retained reader, note/highlight, image, organization, search and deletion requirements.
- [x] Qualify the production service-worker shell in Chromium with web and Jazz stopped, HTTP cache cleared and a complete browser-process restart. Keep broader platform qualification open.
- [x] Emit one browser WASM binary, verify one initial network transfer and immutable reuse across updates; record local startup measurements in offline-shell-implementation.md.
- [x] Qualify the current web deploy preview and Linux source/web/offline/extension suites at `dfc675c`; see the handoff for immutable run/deploy links.
- [ ] Complete product accessibility/performance, broader hosted boundary cases and all claimed browser/mobile release targets against the spec’s acceptance criteria.

Future shared diagnostics: DLF already supplies the logger. A reusable XState observer and bounded error sanitization are still a separate DLF follow-up, not a missing logger dependency or a requirement for this MVP review. See the handoff’s shared-diagnostics note.

Typography presets, the DUI image viewer, custom fonts, reading-time estimation and other accepted deferrals remain outside MVP. This checklist does not expand scope.

## Historical validation for the storage PR

`pnpm verify` passes vendor verification, formatting, lint, TypeScript/Svelte checks, 40 unit tests and the Netlify production build. All five Chromium tests pass. The native 600 KiB payload survives a complete offline browser restart, then syncs to an independently restored account profile. The web shell stays served. Scope-loss and terminal-cleanup tests cover the exercised boundaries; exhaustive scope replacement at every SDK boundary remains open. Large bundle/duplicate WASM warnings remain tracked above.

## Add Link and minimal reader batch

Historical initial-batch evidence (superseded by the current handoff above): see [add-link-implementation.md](add-link-implementation.md). `pnpm verify` and eight Chromium browser tests pass, including UI preview → authority offline → Save → full browser restart → exact text → restored-profile sync. The gateway responses in that UI restart test are fixtures; storage/authority/process boundaries are real. Actual hosted gateway/reader validation is recorded separately. Full offline shell startup, images, concurrent-capture reconciliation, rich reader controls and broader platform qualification remain open. No image completeness or production enablement claim follows from text availability.

## Offline shell batch

See [offline-shell-implementation.md](offline-shell-implementation.md). DLF remains the session/readiness/recovery/persistence integration; Clipper caches only its public build artifacts and prerendered root. Five production Chromium tests cover complete offline browser startup and exact reading with both servers stopped, restored-profile sync, waiting updates across multiple tabs, cache isolation/cleanup, installation failure and retry without replacing the DLF account. The HTTP cache is cleared; the service-worker cache supplies the root response. These are Chromium desktop results, not mobile/Firefox support or eviction-proof storage claims.


## Structured saved reader batch

The reader now displays locally saved HTML with the extractor's shared DOMPurify allowlist, sanitized again at the display boundary. Headings, lists, tables, emphasis, code and referenced footnote locations remain navigable without loading remote assets. Persisted IDs receive isolated display IDs; duplicates and missing fragment targets cannot hijack app controls. External article links and Open original use normal same-tab navigation. Stored snapshots and their identity/normalization versions are unchanged. Unavailable, non-HTML, invalid UTF-8, empty or oversized/pathological markup falls back to exact stored text.

The existing DLF/Jazz account/storage/read owners remain unchanged. The display attachment owns only synchronous DOM projection and clears it on destruction; unchanged content does not re-render on unrelated sync status updates. No new locale strings, dependencies or schema changes are needed. The prior 1 MiB byte bound is supplemented by a conservative 5,000 markup-token bound before DOM sanitization to protect the UI from extreme element counts.

This is partial reader implementation: TOC, footnote popovers, persisted reading position/progress, preferences, annotations and images remain open. Same-tab navigation is qualified separately from the still-unimplemented reading-position restoration requirement. Chromium evidence does not establish other browser/mobile support.


Historical validation: `pnpm verify` passes all 219 unit tests across 26 files, strict application/service-worker typing, lint, formatting, vendor checks and the production build. Nine Chromium integration tests cover retained structure, footnote focus, dangerous-markup removal, no remote image requests, normal same-tab links, exact-text fallback and account/reader cleanup. Five production offline tests include structured headings and footnote navigation with both servers stopped after a full browser restart and HTTP-cache clearing, then structured rendering in the separately restored profile. Gateway extraction responses are fixtures in those UI restart checks; storage, account, browser and sync boundaries are real.


## Local-first startup correction

Use Finance's existing DLF/Jazz startup configuration, `initial: 'local-first'`, to silently initialize a local identity only when needed. A fresh browser opens the private library without a Create account action; stored identities continue to reopen. Explicit sign-out still exposes manual creation/restoration, and restoration follows the existing drain/identity-change path. Local root readiness remains separate from global acceptance. No custom guest identity, account migration, new credential storage or new locale copy is introduced.

Browser checks cover fresh startup without signup, startup with the authority unavailable and identity retention across reload, local/offline save, complete browser restart, independently restored-profile sync, deliberate sign-out/invalid restoration, and gateway authentication through the same managed identity. The previous requirement to click Create account was an omitted startup option, not a required Jazz/DLF boundary.


## Local presentation and gateway correction

The URL field uses DUI InputText, retaining native URL validation, bounded length, accessible label and value binding. Local Jazz identities no longer expose Sign out. An optional restoration form is available directly; its actor drains the current library before calling the existing DLF restoration workflow. Unit coverage includes restoration during an uncertain issued save and sign-out visibility for local versus explicitly signed-in observations. This does not implement external-provider sign-in or merge libraries during restoration.

A real local 503 was traced to shared SvelteKit generated environment files pointing the running dev verifier at the stopped E2E authority on port 5181. Isolate local/agent/E2E generated directories from one another and from build/sync output. Real example.com resolution and extraction both return 200 on the running developer server while E2E runs; no Netlify function emulator is needed. Temporary auth diagnostics were removed and no catalog strings were added.


## One-step Add Link

User direction replaces the initial preview/confirm flow: Add Link resolves/extracts, performs final-destination duplicate/intent checks and automatically starts the existing local save actor. There is no preview state or SAVE event in the library workflow. The prepared candidate is private transient state, cleared on settlement/shutdown. Existing local/sync/uncertain/rejected messages and explicit Open remain; completion stays in the library. Existing saved snapshots are never replaced, and unknown intents are reconciled rather than replayed. FR-053 now records this interaction requirement.

Tests cover a single ADD causing exactly one save, a closed reader until Open, cancellation at preparation boundaries, shutdown/cancel/identity-change drain, uncertain child outcomes and late rejection. UI offline fixtures disconnect the authority just before delivering extraction results, so automatic publication is local/offline without a second user action. Historical limitation: this batch predated the URL-first worker implementation described above.


## Dedicated reader routes

Saved collection/Open controls are normal links to `/articles/[id]`, with a Kit 3 named UUID parameter matcher. The library renders only on `/`. A layout-provided reactive library binding keeps capture/save/sync actors alive across navigation; the reader page requests the current ID and cancels/clears its read when leaving or changing scope. Direct page loads wait for local-first account/root readiness; missing or inaccessible documents use the existing unavailable message. No new locale copy is added.

The service worker maps only exact same-origin, unauthenticated GET document navigations for valid article URLs to the public cached root. Queries, authenticated/range requests, unknown paths and ordinary article fetch requests bypass that fallback. It does not cache any private article response or add document URLs to Cache Storage. The production cold-start proof now opens a reader deep link directly after a complete offline browser restart with both servers stopped and HTTP cache cleared.


Historical validation: all 226 unit tests and twelve Chromium integration tests pass, including direct URL reload, ordinary new-tab link activation, owner-scoped unavailable content and a capture completing after library → reader navigation. Reader OPEN no longer re-enters/reset the parallel capture owner; regression checks cover pending extraction and issued save-child ownership. Five production offline tests pass, including a direct reader deep link after complete offline process restart, fragment-bearing URL reload via the public shell, and restored-profile synchronization. No document URLs/responses enter the shell cache.


## Machine-owned localized feedback

Application-readiness states own localized status resolvers and produce localized feedback errors. Capture/reader states own message resolvers and severity, including failure classification and live local-versus-remote outcomes. The library machine supplies list/empty/disabled/sync messages as well. Offline registration transitions update their localized message alongside status/admission and clear it on close. The DLF recovery contract remains reused, with messages supplied by the owning application machine.

Svelte components render machine-provided text/severity rather than switching status/error codes to translation keys. Static labels/headings/actions remain in presentation. Existing catalog entries and wording are reused; no localization additions are made. Regression tests check pending extraction, local saving, remote rejection, capture error categories, reader load/unavailability/closure, account bootstrap/feedback and offline registration/update/failure messages.

## SVG and native disclosure policy

The shared extraction/display policy retains `details`, `summary`, `open`, and static SVG shapes, paths, groups, text, title/description, geometry and solid paints. SVG links/IDs/references, CSS, images, embedded HTML, filters and animation are removed; gradients and `use` definitions remain unsupported. SVG attributes are limited to 16 KiB each and the existing article byte/node limits still apply. Display width is constrained to the reader. This is a bounded static subset, not arbitrary SVG support or a general SVG security audit. See the accepted [design decision](design-decisions.md#retained-disclosure-and-svg-content).
