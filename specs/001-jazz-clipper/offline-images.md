# Offline article images

Based on merged reader PR #17 (`89ad4e7`), on `feat/offline-article-images`. This batch implements inline saved images, incremental background acquisition, bounded worker processing, native local persistence/synchronization, per-image Retry and offline restart. No viewer, gallery, image-management UI, annotations or new dependency.

## State/resource plan

Text publication atomically declares at most 250 unique HTTP(S) image sources in a private articleImages table. Sanitized HTML retains encoded inert source markers and alt text, never external image src/srcset. Existing snapshots remain immutable. Existing articles whose snapshots have no markers are not refreshed or backfilled.

A library-owned image queue observes these durable declarations independently of the current route. Its states select pending work, wait for connectivity/backoff, fetch through the authenticated public-only gateway, invoke one processing worker, and issue a native DLF transaction. Fetch/processing exit cancels its resource; issued writes drain before account/library shutdown. Named predicates gate eligibility. Five attempts per runtime/connectivity cycle, exponential jittered backoff capped at five minutes, a queue-wide Retry-After wait, and manual retry for failed jobs. Completed work is never downgraded. Unknown writes are blocked in the running owner with uncertainty feedback retained across reader navigation. Before acquisition after startup/retry, an explicit reconciliation state checks the persisted native operation ID; publication checks it again in the same transaction. Existing native operations are not blindly replayed.

The processing worker checks declared image dimensions before decode (PNG/JPEG/WebP/GIF; other formats remain unavailable), enforces 40 MP and 4 MiB gateway input, then decodes/resizes/encodes in explicit states. Long edge at most 2048 px, no upscale. PNG inputs use lossless PNG; other supported inputs use WebP quality 0.82. Oversized outputs progressively reduce dimensions, bounded attempts, at most 2 MiB output. GIF is saved as a static frame; no animation/viewer promise. Bitmap and worker resources have owned lifetimes.

Native publication reuses storageOperations, immutable assets bytes and the DLF transaction lifecycle. A declaration references its same-library immutable snapshot; ready points to an owned native asset. Library/document/image eligibility checks and mutation share a transaction. Owner policies reject foreign rows/assets and prevent ready records being overwritten. Local persistence and global acceptance remain distinct.

Reader image children belong to the image queue and exist only while a reader is attached. They observe their declared source, load native bytes, and own object URLs. Pending/failure/uncertain feedback is machine-owned; small DUI-based presentation components only render it and send Retry. Reader detach releases object URLs and subscriptions. Images are hydrated without replacing article text/selection or changing the normalized reading-text index. No source image URL is used by the browser renderer.

## Validation

Unit/native coverage: extraction markers/alt, inert reader rendering, image header/output bounds, state transitions/cancellation/backoff, unknown-write suppression, local persistence and owner/parent policies. Browser coverage: actual worker decode/encode, inline rendering without source requests, text before slow images, failed-image Retry, navigation/background lifetime, restored-client sync and full offline process restart. Run repository checks, web/offline/extension checks appropriate to shared schema/capture changes, then review the finished diff and fix findings before opening an unmerged PR.


## Review and remaining limits

The final review checks scope admission/result consumption, native transaction boundaries, independent resource cleanup and unchanged reader/save/identity flows. Fixes include owned worker acquisition before posting input, explicit fetch-failure routing, draining writes even when observation fails, strict worker response schemas, Retry-After and capped jitter, stale image-URL error guards, a read-only image-view capability, uncertainty retained across route changes, and preserving populated reader history during the additive migration.

All image bytes in this batch use the 4 MiB public gateway path, including URLs collected by the extension. The planned larger direct-extension byte path is not implemented. PNG inputs use lossless output; this is not a general perceptual quality guarantee. Data/blob URLs, source authentication/cookies, SVG/AVIF downloads, image backfill for old snapshots and broad device/Firefox image-processing qualification are deferred. Inline sanitized static SVG already stored with article text retains its existing behavior. Codec errors and unavailable bytes remain explicit; no automatic content refresh or schema reset is used. Current feedback reuses approved labels/templates; the proposed additional loading/failure wording is optional and is not added without approval.


## Qualification results

`pnpm verify` passes vendor integrity, formatting (including Svelte), lint, strict root/web/service-worker/extension types, 583 unit/native tests across 86 files with one platform skip, and the production build. The full web suite passes all 57 cases in one run, including actual PNG/JPEG/WebP/GIF worker processing, selection preservation, per-image failure/Retry, independent-client synchronization and restart with Jazz unavailable. All five production offline cases pass; the image proof fully restarts Chromium with both servers stopped and HTTP cache cleared, then displays locally reconstructed image bytes. Eleven rebuilt Chromium extension cases and two sample-data cases also pass. The live network frontend rendered a public PNG through its real authenticated gateway from a saved native blob; fixture text and a disposable account were used. No shared authority/frontend process was restarted.

The completed code review found and fixed partial worker setup cleanup, write draining during observation failure, raw worker response validation, retry eligibility in named guards/states, global Retry-After pacing, stale scope/URL errors, viewer capability narrowing, uncertainty across navigation and native operation reconciliation. Review is an implementation review, not a claim of broad device/format quality qualification. Tests run on host Node 25.2.1; CI's pinned Node is 24.22.2. No package or new catalog copy was added.
