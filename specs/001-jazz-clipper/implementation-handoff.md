# Implementation handoff

**Status**: Foundation storage and hosted authenticated gateway are implemented and qualified. The Add Link batch adds a runtime-owned Add Link → automatic local save → saved reader, immutable source provenance and final-destination duplicate checks. Offline UI saves survive a full Chromium restart and sync to a restored profile. The offline-shell batch additionally qualifies cold startup with both servers stopped and HTTP cache cleared; see [offline-shell-implementation.md](offline-shell-implementation.md). The structured-reader batch displays saved HTML with isolated internal anchors and safe literal-text fallback; see [tasks.md](tasks.md). Images, full reader/annotation workflows and broader platform/release qualification remain open. See [tasks.md](tasks.md) and [add-link-implementation.md](add-link-implementation.md).

## First batch: application foundation and durable private root

Items 1–5 are implemented for the session/private-root path; item 6 is implemented as a bounded repository capability in the current PR. Item 7 has storage/restart evidence; full offline shell and platform qualification remain open. See [session-implementation.md](session-implementation.md), [storage-implementation.md](storage-implementation.md) and [tasks.md](tasks.md) for evidence and remaining work. Tooling commands and scope are documented in [docs/tooling.md](../../docs/tooling.md).

Build only the new workspace/toolchain and the smallest browser session → canonical private library → local text/bytes → reopen path. Start from the spec-only `main`; the old prototype remains preserved on the archive branch. The canonical root remains domain-owned; storage transactions reuse DLF’s generic transaction resource owner without introducing workspaces.

1. Establish Clipper's repository agreements and minimal pnpm workspace. Pin the selected Svelte/Kit/Vite/XState/Jazz/TypeScript baseline, Node 24, and the exact DLF/DUI archives by digest. Verify archive export/peer compatibility rather than taking a different private `0.0.0` build. Lock extractor/search/localization packages only when the relevant module enters the batch; do not install future PDF/EPUB/viewer packages.
2. Add the client-rendered SvelteKit shell and one minimal route, with localizable status descriptors and browser integration outside presentation. No speculative reader styling, account settings suite or workspace chooser. Use native CSS/DUI where applicable.
3. Integrate the existing packaged DLF session acquisition, readiness and recovery/restoration exports. One runtime owner; account changes invalidate scoped work, drain issued writes and clear stale views. No new credential system or DLF production edits.
4. Define the canonical root schema and actual storage policies: library ID equals the authenticated account UUID, immutable owner/bootstrap-format payload, owner-only reads, canonical-ID/owner guards on inserts and updates. Ensure only that identical immutable payload; never overwrite mutable records as a retry strategy. Catch unsupported query shapes as errors, not empty results.
5. Model bootstrap and repository operations with XState ownership before async application code. Idempotent root ensure is Clipper domain persistence, not generic workspace creation. Article/note operations still need stable operation journals and honest unknown-write outcomes.
6. Wire one small owner-scoped text/byte record path and explicit local versus sync status. Package and version the SDK WASM/broker assets at their actual requested URLs. Load them locally; measure the 19.3 MB raw WASM startup cost and avoid duplication.
7. Qualify this batch under the actual Node 24 toolchain and browser build: strict source checking, appropriate lint/build, owner-denial checks, two independent same-account replicas ensuring one root, local byte persistence, page close/reopen and fully offline shell/process restart. The completed isolated experiments are supporting evidence, not replacements for these application checks.

**Batch exit**: new shell builds; DLF restores the same account; the canonical root is private and stable; explicit local text/byte saving survives the qualified restart; no old-account data or optimistic-only Saved confirmation. Failures remain recoverable and visible. No Add Link or extension success claim before their batches.

## Subsequent dependent batches

| Order | Deliverable | Required proof before enabling it |
| --- | --- | --- |
| 2 | Authenticated public-source gateway and Add Link → saved snapshot → offline reading | Public SDK bearer/verifier adapter; registry failure classification; Linux native packaging; actual destination-pinned, redirect-safe transport; parser/sanitizer bounds; local persistence. |
| 3 | Desktop extension intake and source/reader annotations | Versioned packaged runtime assets and strict CSP; real sender validation, permissions, background journal/restart behavior; exact normalized selectors and explicit ambiguity; Chrome and Firefox packages. |
| 4 | Notes/highlights/images and reader controls | Single-note draft/conflict protection; overlap access and Undo; incremental byte processing; preserved footnotes; typography/theme, positions/progress, TOC and distraction-free accessibility. |
| 5 | Organization/search/deletion and release qualification | Shared tags with distinct assignments; offline search and Trash scopes; tombstone cleanup; cross-device changes; Android share/iOS fallback; accessibility, performance and Netlify preview acceptance. |

Design dependencies may require building a small underlying module earlier; that does not move its whole feature/UI into the first batch. Full product completion requires all retained requirements and SC-001–011.

## Fixed technical choices

- One repository; private account-scoped library and canonical immutable root; no collaboration or generic workspace UI.
- DLF owns identity/recovery; Clipper owns library/domain data; DUI owns generic presentation. Generic DLF creation remains separate work.
- Current SDK bearer is obtained only inside the trusted request adapter; no config/token snapshots in UI, logs, workers or content scripts. Public server verification binds to the app and canonical registry. Dedicated proof minting returned null in the tested managed-session path; do not export roots as a workaround.
- Readability baseline: full inert DOM for fetched HTML, correctly serialized capture input for the lightweight worker parser. Collect/sanitize footnote targets before pruning and construct final text/anchor mapping afterward. No third-party extraction service.
- i18next runtime instances; worker MiniSearch; native owner-scoped Jazz byte assets. Pin investigated versions and qualify on the selected runtime.
- Desktop Chrome/Firefox extensions, supported Android PWA share intake, iOS Add Link. Actual minimum versions and all device claims require qualification.

## Security/deployment work is implementation, not another discovery loop

A qualified public fetch transport can use Node HTTP(S) request lookup/connection controls: resolve/check all returned addresses; select/pin an allowed address; retain original Host and TLS SNI/certificate verification; validate actual socket peer; disable uncontrolled proxy/pooled reuse; follow redirects manually with complete revalidation and total bounds. Reject credentials, non-HTTP(S), prohibited ports and every private/reserved form, including mapped IPv6. DNS preflight followed by ordinary auto-resolving fetch is insufficient. Build and exercise this boundary before enabling gateway use; Netlify preview must confirm the actual transport and native modules.

The Node APIs are documented for the [target Node 24 HTTP runtime](https://nodejs.org/docs/latest-v24.x/api/http.html); address/redirect defenses follow [OWASP SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html). This is a design mapping, not a passed SSRF audit or deployed network proof.

## Review boundary

Implementation is authorized and underway through feature branches and PRs. The archived investigation is supporting evidence only. Current validation and unchecked acceptance work are recorded in [tasks.md](tasks.md); no dependent product workflow should be treated as complete from repository capabilities alone.
