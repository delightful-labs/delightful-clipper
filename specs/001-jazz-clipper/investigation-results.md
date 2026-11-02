# Investigation results and implementation readiness

**Date**: 2026-11-02. **Outcome**: Ready to begin a bounded Clipper foundation implementation. Production application, DLF source and production dependencies remain unchanged. These findings supplement the earlier authority proof; they do not certify the complete MVP.

## Executed experiments

Experiments ran in disposable directories, using synthetic accounts and isolated browser contexts/profiles. No Readwise/Hypothesis/user library data was accessed or modified. Local servers required elevated listener permission; automatic approval allowed them. Dependency downloads were confined to a separate disposable extraction directory with install scripts disabled. Existing application dependency trees were read or linked, never installed into.

| Experiment | Observed result and boundary |
| --- | --- |
| Packaged DLF session and readiness | Existing `delightful-local-first-0.0.0-readiness.tgz` public exports opened browser sessions successfully. Recovery/restoration adapters also loaded through the actual packaged subpaths. This supersedes the earlier source-only adapter experiment. |
| Browser persistence | Disconnect SDK transport; persist a previously unuploaded string row and byte asset at local tier; stop authority; close session/page; open a new page and read locally. Row and exact bytes `[7,8,9,10]` survived. The fixture web server still served application assets, so this does not prove offline PWA-shell loading or a full browser-process restart. |
| Cross-origin restoration | Pass a synthetic recovery phrase directly between fixture pages through the disposable automation process; restore through DLF's packaged adapter in a trusted extension page. Same account ID resulted. No phrase, secret or bearer token was printed or saved as evidence. This is recovery adapter qualification, not a finished recovery UI. |
| Packaged Chromium extension | Manifest V3 trusted page, local script/worker policy plus `wasm-unsafe-eval`: session startup, same-account restoration and local string/byte persistence passed. Close extension page/session and reopen with authority stopped: same local data returned; no page errors. No extension was installed in the user's browser profile. Content-script capture and background suspension remain untested. |
| Browser → Node request verification | SDK-managed session's current bearer token verified via public `resolveRequestSession` configured with the fixture app ID and canonical account registry. HTTP 200 resolved the same account; a tampered bearer returned 401. Linux Netlify packaging and deployment are not covered. |
| Canonical library root | Two same-account SDK contexts concurrently upserted the same immutable account-ID root; repeating the same payload left one row. Policy rejected alternate root IDs and foreign read/write attempts. This does not prove two independent offline replicas converge; that remains an implementation acceptance case. |
| Extraction | Readability on inert jsdom versus its lightweight JSDOMParser in a Node worker produced equivalent sanitized text for six synthetic serialized fixtures: inline markup, Unicode, repeated quote, footnote, image and hostile markup. Script/event/unsafe-link/iframe cases were removed from fixture output. This is not a sanitizer audit or representative article-quality benchmark. |
| Footnote negative finding | Readability removed the fixture's referenced footnote target. Target remained in the inert source DOM before extraction. Explicit footnote collection/preservation is required; parity between two extractors does not mean required content survived. |
| Search/localization | MiniSearch AND query and replacing an indexed note behaved as planned. Separate i18next instances retained independent languages. This is core-library evidence, not completed Svelte reactive or packaged search-worker integration. |

Unicode experiment demonstrated the UTF-16/code-point offset difference around an emoji and exact quote recovery using code-point slicing. Repeated quote enumeration returned two candidates. It did not qualify Clipper's complete normalization, grapheme mapping or ambiguity algorithm; SC-003's 90% target remains unevaluated.

## Concrete discoveries and decisions

### One private library does not need generic workspace creation

Earlier planning treated unbuilt DLF multi-workspace creation as a prerequisite for Clipper. That was too broad. DLF's current contract already leaves concrete app schemas, policies and data operations with the host. Clipper needs one private personal library, not generic creation/naming/invitation UI.

Select a canonical library row ID equal to the authenticated account UUID, within Clipper's application/table namespace. Initial root payload contains only immutable owner ID and bootstrap format `1`. Storage policy requires both row ID and owner ID to equal the authenticated account and enforces immutable bootstrap fields. Read scope remains owner-only; an overly restrictive combined read policy produced an SDK query-coverage error in the experiment, so do not duplicate write-only predicates into every read policy.

Bootstrap is an idempotent ensure of this exact immutable root, not creation inferred from an empty directory. It does not create a new identity, reset preferences or mutate existing articles. A restored account ensures the same root. Conflicting values or unsupported schema produce an integrity/compatibility outcome, not an overwrite. User-editable fields and future schema migration stay outside the repeatable payload.

The root experiment passed concurrent contexts, replay, alternate-ID denial and unrelated-account denial. Validate independent offline replica convergence in implementation. Only this identical immutable ensure is eligible for safe repeat; arbitrary uncertain document/note writes still require their operation journals and reconciliation. Generic DLF private creation remains separate foundation work and need not delay this Clipper domain root.

### Request authentication uses the existing SDK boundary

`Db.getLocalFirstIdentityProof()` exists but returned null for the public account-managed session path. Source inspection explains why: that path supplies a managed JWT and does not initialize the Db's private local seed. Do not export a recovery root or call an internal mint helper to work around it.

The experiment successfully used the current `Db.getConfig().jwtToken` through a trusted request leaf. Select that public-API compatibility adapter for the pinned SDK: read just the current bearer immediately before dispatch, never expose/log/persist the configuration object, and send only to the fixed first-party gateway. Missing/expired credentials remain authentication outcomes; account changes invalidate in-flight request results. SDK-managed renewal remains the session owner's responsibility. A cleaner dedicated current-token/request API is an upstream improvement, not a second recovery system or prerequisite for initial code.

The server uses public `jazz-tools/backend` verification with app ID and canonical registry. Credential rejection returns 401; registry/configuration failure returns 503. A verified identity still must be authorized for the gateway operation. No signature-only standalone mode or client-supplied owner ID substitutes for that binding.

### Package every executable runtime asset

Default production Vite bundling emitted hashed WASM but the tested SDK account startup requested root `/jazz_wasm_bg.wasm`. The initial extension startup failed with missing-file errors, not a permission denial. Including the expected local WASM file fixed startup; the final packaged extension checks passed.

Implementation must make runtime asset URLs explicit/versioned or deliberately emit the expected path. Keep scripts, broker workers and WASM inside the extension package; do not use remote code, unsafe-eval or blob-script exceptions. The fixture emitted a roughly 19.3 MB raw WASM payload (about 6.46 MB gzip) and two broker bundles. Avoid duplicate WASM copies in production and measure cold startup; a successful build is not a mobile-performance pass. Browser shell precaching must include the chosen immutable runtime assets.

Chrome's permitted WASM CSP and Firefox's packaged-code rules support this approach in principle; only Chromium was executed here. See [Chrome CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy), [Mozilla extension CSP](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_Security_Policy) and [Playwright isolated extension guidance](https://playwright.dev/docs/chrome-extensions).

### Preserve footnotes before extraction

Collect referenced note IDs/content from the inert captured DOM before Readability mutates/prunes it. Sanitize those targets and retain an ID mapping as footnote metadata; inject referenced note blocks into the final saved representation or render their saved metadata in accessible popovers with an in-document destination. Derive normalized text/anchors only after this final representation is constructed. Do not append unsanitized source HTML or run a second implicit extraction service.

Readability + serialized JSDOMParser remains the baseline. Raw fetched HTML uses a full inert Node parser. Worker output is untrusted and must cross the rendering sanitizer boundary. The synthetic checks support implementation, not a claim that all inconsistent web footnotes are detectable. See [Readability](https://github.com/mozilla/readability) and [DOMPurify](https://github.com/cure53/DOMPurify).

## Environment and reproducibility

- Host: Node 25.2.1. Planned Node 24 must be exercised during setup; it was not installed at the checked standard paths.
- SDK: Jazz, jazz-napi and jazz-wasm 2.0.0-alpha.59; Vite 8.3.4; TypeScript 6.0.3; Svelte 5.57.2.
- Packaged DLF archive: Finance worktree `vendor/delightful-local-first-0.0.0-readiness.tgz`; SHA-256 `52947031226dfdc5bfa86d04b568c455bb3e19e93eb715b11450e0df4026db4e`. Do not identify private `0.0.0` archives by version alone.
- Browser: automated isolated Chromium 156.0.8078.4; separate Chrome MCP observation reported Chrome 156 on macOS. No Firefox, iOS or Android device result is claimed.
- Disposable extraction dependencies: Readability 0.6.0, jsdom 29.1.1, DOMPurify 3.4.17, MiniSearch 7.2.0 and i18next 26.7.1. These are investigated pins, not changes to the application package manifest.
- Production-style extension fixture build passed. Bundle-size warnings are recorded above, not suppressed.
- Native package metadata includes Linux x64/arm64 GNU optional binaries. Netlify must install/package the matching binary on Linux, not copy this Mac dependency tree. [Netlify function configuration](https://docs.netlify.com/build/functions/configuration/) and [native/external module bundling](https://docs.netlify.com/build/configure-builds/file-based-configuration/) provide configuration mechanisms; no deployed proof was attempted.

Experiments are recipes, not production implementations: temporary Vite host + synthetic schema, public packaged DLF adapters, isolated browser profiles, fixed byte assertions, local authority stop/page close/reopen, and separate parser fixtures. Public docs confirm [i18next instance isolation](https://www.i18next.com/overview/api). No network credentials or private article fixtures are needed to reproduce them.

## Remaining implementation acceptance gates

Ready to start does not mean ready to ship. Implement and qualify: the production schema/policy graph, independent offline root convergence, interrupted domain commits, note-conflict retention, fully offline shell/browser-process restart, actual extension capture/background lifecycle, Firefox and mobile, representative extraction/anchor/image fixtures, and Linux Netlify request-auth/native packaging and network enforcement. These require implementation artifacts or deployment/device evidence; additional speculative planning cannot pass them.

The first implementation batch in [implementation-handoff.md](implementation-handoff.md) is bounded around those dependencies. No additional product decision is currently required.

## Cleanup

All disposable authority/Vite servers were stopped. Playwright fixture profiles were removed after their runs; the Chrome MCP fixture page's local account storage and IndexedDB were cleared before closing that page. Temporary downloaded packages, extracted DLF archive and experiment working directories were removed. The user's existing browser tabs and signed-in services were left unchanged.
