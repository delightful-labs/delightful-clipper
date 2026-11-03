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
- [ ] Clear retained read-actor content at terminal states and qualify scope loss during every asynchronous boundary.
- [x] Qualify parent-reference consistency and missing/invalid native assets while preserving readable text.
- [x] Exercise shutdown during acquisition/commit/local wait, unknown settlement without replay, and late remote rejection; treat missing stage output as unknown.
- [x] Save unuploaded text/bytes with the authority stopped, close the complete browser process, reopen the same profile and verify exact local content.
- [x] Reconnect and verify that content in a separately restored account profile.
- [ ] Wire consuming actor ownership and drain into the eventual product capture flow; no storage write UI is currently enabled.

## Gateway foundation

- [x] Add authenticated, bounded resolve/extract endpoints with public-address pinning and redirect revalidation.
- [x] Add inert Readability extraction, explicit DOMPurify allowlists and referenced footnote preservation.
- [x] Qualify local transport/cancellation/address/sanitizer fixtures and a live authenticated public HTTPS extraction.
- [ ] Qualify Netlify-hosted native verifier packaging and actual public-only transport before enabling the deployment flag. Connector access currently requires authentication.

## Subsequent product and release work

- [ ] Build the authenticated public-source gateway and Add Link workflow, including redirect/short-link identity, destination-pinned transport and extraction/sanitization bounds.
- [ ] Implement desktop extension intake and annotation anchoring with sender validation, packaged runtime assets and restart reconciliation.
- [ ] Implement retained reader, note/highlight, image, organization, search and deletion requirements.
- [ ] Add and qualify the service-worker/offline app shell; existing browser tests keep the web server available.
- [ ] Resolve duplicate approximately 19.3 MB WASM outputs and measure startup/download performance.
- [ ] Qualify Netlify deployment, accessibility and all claimed browser/mobile targets against the spec’s acceptance criteria.

Typography presets, the DUI image viewer, custom fonts, reading-time estimation and other accepted deferrals remain outside MVP. This checklist does not expand scope.

## Validation for the storage PR

`pnpm verify` passes vendor verification, formatting, lint, TypeScript/Svelte checks, 40 unit tests and the Netlify production build. All five Chromium tests pass. The native 600 KiB payload survives a complete offline browser restart, then syncs to an independently restored account profile. The web shell stays served. Scope-loss and terminal-cleanup tests cover the exercised boundaries; exhaustive scope replacement at every SDK boundary remains open. Large bundle/duplicate WASM warnings remain tracked above.
