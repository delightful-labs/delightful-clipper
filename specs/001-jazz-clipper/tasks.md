# Implementation tasks and acceptance status

Updated 2026-11-03. This is the current implementation checklist; the product requirements remain in spec.md. An implemented capability is not a completed product workflow.

## Completed foundation

- [x] Pin workspace tooling and vendor archives; provide build, lint, type-check and test commands.
- [x] Integrate DLF session acquisition/readiness, account creation, recovery and restoration with one runtime owner.
- [x] Implement canonical private library bootstrap with separate local/global settlement and teardown drain.
- [x] Qualify session/root actors, authority policies and Chromium account reload/restoration/offline root restart.
- [x] Add immutable owner-scoped storage operations, native byte assets, text snapshots and document publication records.
- [x] Reuse DLF transaction resource ownership for bounded intent → atomic native snapshot/asset/document publication stages.
- [x] Add bounded domain preparation with operation fingerprints, repository save/read actors and separate remote-acceptance receipts.
- [x] Exercise real-authority native-byte/Unicode round-trip, duplicate operation blocking, account read denial, immutable-row denial, atomic foreign-library rejection, staging invisibility and oversize rejection in repository tests.

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

- [x] Build authenticated Add Link → preview → explicit local save → minimal text reader, with final-destination duplicate checks, provenance and honest remote status.
- [x] Render saved HTML structure with a shared sanitizer allowlist, isolated internal anchors, normal same-tab article links and literal-text fallback; qualify offline restart and restored-profile rendering.
- [ ] Complete image acquisition, richer saved reader requirements and durable pre-save intake recovery; the current preview is ephemeral.
- [ ] Implement desktop extension intake and annotation anchoring with sender validation, packaged runtime assets and restart reconciliation.
- [ ] Implement retained reader, note/highlight, image, organization, search and deletion requirements.
- [x] Qualify the production service-worker shell in Chromium with web and Jazz stopped, HTTP cache cleared and a complete browser-process restart. Keep broader platform qualification open.
- [x] Emit one browser WASM binary, verify one initial network transfer and immutable reuse across updates; record local startup measurements in offline-shell-implementation.md.
- [ ] Qualify Netlify deployment, accessibility and all claimed browser/mobile targets against the spec’s acceptance criteria.

Typography presets, the DUI image viewer, custom fonts, reading-time estimation and other accepted deferrals remain outside MVP. This checklist does not expand scope.

## Validation for the storage PR

`pnpm verify` passes vendor verification, formatting, lint, TypeScript/Svelte checks, 40 unit tests and the Netlify production build. All five Chromium tests pass. The native 600 KiB payload survives a complete offline browser restart, then syncs to an independently restored account profile. The web shell stays served. Scope-loss and terminal-cleanup tests cover the exercised boundaries; exhaustive scope replacement at every SDK boundary remains open. Large bundle/duplicate WASM warnings remain tracked above.

## Add Link and minimal reader batch

See [add-link-implementation.md](add-link-implementation.md). `pnpm verify` and eight Chromium browser tests pass, including UI preview → authority offline → Save → full browser restart → exact text → restored-profile sync. The gateway responses in that UI restart test are fixtures; storage/authority/process boundaries are real. Actual hosted gateway/reader validation is recorded separately. Full offline shell startup, images, concurrent-capture reconciliation, rich reader controls and broader platform qualification remain open. No image completeness or production enablement claim follows from text availability.

## Offline shell batch

See [offline-shell-implementation.md](offline-shell-implementation.md). DLF remains the session/readiness/recovery/persistence integration; Clipper caches only its public build artifacts and prerendered root. Five production Chromium tests cover complete offline browser startup and exact reading with both servers stopped, restored-profile sync, waiting updates across multiple tabs, cache isolation/cleanup, installation failure and retry without replacing the DLF account. The HTTP cache is cleared; the service-worker cache supplies the root response. These are Chromium desktop results, not mobile/Firefox support or eviction-proof storage claims.


## Structured saved reader batch

The reader now displays locally saved HTML with the extractor's shared DOMPurify allowlist, sanitized again at the display boundary. Headings, lists, tables, emphasis, code and referenced footnote locations remain navigable without loading remote assets. Persisted IDs receive isolated display IDs; duplicates and missing fragment targets cannot hijack app controls. External article links and Open original use normal same-tab navigation. Stored snapshots and their identity/normalization versions are unchanged. Unavailable, non-HTML, invalid UTF-8, empty or oversized/pathological markup falls back to exact stored text.

The existing DLF/Jazz account/storage/read owners remain unchanged. The display attachment owns only synchronous DOM projection and clears it on destruction; unchanged content does not re-render on unrelated sync status updates. No new locale strings, dependencies or schema changes are needed. The prior 1 MiB byte bound is supplemented by a conservative 5,000 markup-token bound before DOM sanitization to protect the UI from extreme element counts.

This is partial reader implementation: TOC, footnote popovers, persisted reading position/progress, preferences, annotations and images remain open. Same-tab navigation is qualified separately from the still-unimplemented reading-position restoration requirement. Chromium evidence does not establish other browser/mobile support.


Validation: `pnpm verify` passes all 219 unit tests across 26 files, strict application/service-worker typing, lint, formatting, vendor checks and the production build. Nine Chromium integration tests cover retained structure, footnote focus, dangerous-markup removal, no remote image requests, normal same-tab links, exact-text fallback and account/reader cleanup. Five production offline tests include structured headings and footnote navigation with both servers stopped after a full browser restart and HTTP-cache clearing, then structured rendering in the separately restored profile. Gateway extraction responses are fixtures in those UI restart checks; storage, account, browser and sync boundaries are real.
