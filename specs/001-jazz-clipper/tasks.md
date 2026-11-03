# Implementation tasks and acceptance status

Updated 2026-11-02. This is the current implementation checklist; the product requirements remain in spec.md. An implemented capability is not a completed product workflow.

## Completed foundation

- [x] Pin workspace tooling and vendor archives; provide build, lint, type-check and test commands.
- [x] Integrate DLF session acquisition/readiness, account creation, recovery and restoration with one runtime owner.
- [x] Implement canonical private library bootstrap with separate local/global settlement and teardown drain.
- [x] Qualify session/root actors, authority policies and Chromium account reload/restoration/offline root restart.
- [x] Add immutable owner-scoped storage operations, manifests, byte parts, text snapshots and document publication records.
- [x] Reuse DLF transaction resource ownership for bounded intent → parts → verification → publication stages.
- [x] Add bounded gzip/SHA-256 codecs, repository save/read actors and separate remote-acceptance receipts.
- [x] Exercise real-authority multipart/Unicode round-trip, duplicate operation blocking, account read denial, immutable-row denial, atomic foreign-library rejection, staging invisibility and oversize rejection in repository tests.

## Storage qualification before enabling a product write flow

- [ ] Harden malformed-manifest validation: safe-integer lengths, part bounds before hashing, deterministic part identity checks.
- [ ] Clear retained read-actor content at terminal states and qualify scope loss during every asynchronous boundary.
- [ ] Qualify parent-reference consistency and partial/corrupt assets while preserving verified text.
- [ ] Exercise shutdown during acquisition/commit/local wait, unknown settlement without replay, and late remote rejection; treat missing stage output as unknown.
- [ ] Save unuploaded text/bytes with the authority stopped, close the complete browser process, reopen the same profile and verify exact local content.
- [ ] Reconnect and verify that content in a separately restored account profile.
- [ ] Wire consuming actor ownership and drain into the eventual product capture flow; no storage write UI is currently enabled.

## Subsequent product and release work

- [ ] Build the authenticated public-source gateway and Add Link workflow, including redirect/short-link identity, destination-pinned transport and extraction/sanitization bounds.
- [ ] Implement desktop extension intake and annotation anchoring with sender validation, packaged runtime assets and restart reconciliation.
- [ ] Implement retained reader, note/highlight, image, organization, search and deletion requirements.
- [ ] Add and qualify the service-worker/offline app shell; existing browser tests keep the web server available.
- [ ] Resolve duplicate approximately 19.3 MB WASM outputs and measure startup/download performance.
- [ ] Qualify Netlify deployment, accessibility and all claimed browser/mobile targets against the spec’s acceptance criteria.

Typography presets, the DUI image viewer, custom fonts, reading-time estimation and other accepted deferrals remain outside MVP. This checklist does not expand scope.

## Validation for the storage PR

`pnpm verify` passed: vendor verification, formatting, lint, TypeScript/Svelte checks (zero diagnostics), 22 unit tests across four files and the Netlify production build. `pnpm test:e2e` passed all three existing Chromium session/root tests. The build still warns about a large application chunk and emits duplicate WASM assets as tracked above. The unchecked storage lifecycle/browser scenarios above are not claimed as passed.
