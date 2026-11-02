# Clipper logical data model

**Status**: proposed Jazz table mapping; owner authorization, schema deployment and durability proof are gates. Field names below are contracts for planning, not claims of existing package exports.

## Identity and authorization

Every source-of-truth row carries or inherits an enforced `libraryId`/owner relation. The library belongs to one DLF/Jazz account. Every client read/write and byte-part relationship must enforce the same owner server-side; UI filters are insufficient. Tags, annotations, snapshots and assets cannot reference another owner's rows. No public grants or collaborative roles are introduced.

## Records

| Record | Important fields | Relationships / invariants |
| --- | --- | --- |
| Library | ID = authenticated account UUID, immutable owner ID and bootstrap format 1 | One canonical root per account; idempotently ensure only this immutable payload. Empty replicas never trigger another identity or random root ID; mutable data/migrations are separate. |
| Document | ID, libraryId, originalSavedAt, title/author, status, favorite, trashedAt?, priorStatus?, snapshotId?, captureState | Status is Inbox/Later/Archive. Trash is separate lifecycle. Saved snapshot immutable; no refresh selector. Original save time orders list newest first and does not change on re-clip. |
| CaptureAttempt | ID, operationKey, account/device scope, submittedURL, resolvedURL?, redirectObservations[], canonicalCandidate?, acceptedIdentity?, parserVersion?, attemptCount, timestamps, outcome, error descriptor | Durable before navigation. One document result or accepted existing-document reference. Provenance is evidence, not authorization to merge all URL aliases forever. |
| SourceIdentity | ID, libraryId, normalized accepted URL key, documentId, evidence kind/time, redirect target? | Preserve raw observed aliases separately. Revalidate shortening destinations. Duplicate reconciling must retain annotations and captures. |
| Representation | ID, documentId, kind source/reader, normalizationVersion, selectorVersion, textHash, textLengthCodePoints, sanitized payload manifest, heading/footnote metadata | A successful reader snapshot is fixed in MVP. Source representation may retain selectors/quote/provenance rather than a full duplicate raw page. No historical revision UI required. |
| Asset | ID, documentId, sourceURL, mediaType, byteCount, width/height?, hash, manifestId, processingVersion | Content-addressed only within owner scope; reference tracking prevents deleting bytes needed by another retained record. |
| BlobManifest / BlobPart | ID, owner/library, manifestId, ordinal, hash, byte length, byte payload | Parts staged locally first; complete manifest published only when every expected part is durable and hashes match. Full-file memory buffering is bounded. |
| Annotation | ID, documentId, originalQuote, createdAt, deletedAt?, defaultColor? | Stable ID; one color in MVP, optional metadata supports future colors. One logical annotation can have multiple rendered spans and representations. Overlaps never merge. No resize command. |
| Anchor | ID, annotationId, representationId, selectors, normalizationVersion, status resolved/ambiguous/unresolved, derivedFrom? | W3C-compatible quote exact/prefix/suffix and code-point start/end; optional internal DOM path. Original selectors immutable. Deriving a reader anchor does not overwrite source evidence. No candidate repair workflow. |
| Note | ID, parentType article/highlight, parentId, content, editedAt, deletedAt? | One active editable note per parent, identity deterministically associated with parent to avoid duplicate creation on two offline devices. Plain text, linkification at view. Retain conflicting text until reconciled rather than last-write overwrite loss. |
| Tag | ID, libraryId, displayName, normalizedKey, deletedAt? | Trim outer whitespace; case-insensitive identity. Proposed Unicode NFC + locale-independent fold/version; implementation must qualify non-ASCII collisions before schema lock. Rename collision fails clearly rather than silently merge. |
| TagAssignment | ID, tagId, targetType article/highlight, targetId | Unique relation, no inherited parent/child assignment. Global deletion removes/hides assignments including Trash. |
| ReadingPosition | ID, account/document/representation/device, logical locator, quote/context?, lastInteractionAt, operationId, furthestLocator? | Per-device observations prevent sync write storms. Pick latest observed timestamp with deterministic operation-ID tie-breaker; clocks are imperfect. Apply only when opening, never jump an active article. Progress and last location separate. |
| ReaderPreferences | ID, account, theme Light/Dark/System, fontFamily, fontSize, lineSpacing, readingWidth | Shared preferences with local cached value. No named presets, width matching, custom font upload, or per-device overrides. |

## Device-local records (not synced authority)

- Availability ledger keyed by account/representation/asset: expected parts, locally durable hashes, last verification; derive offline-complete only after bytes are verified locally.
- Capture journal for external share/extension intake before account readiness. Raw URL is retained, account binding occurs explicitly; never assign a signed-out capture silently to a different user. Journal records have TTL only for abandoned intake after a documented policy, not automatic Trash expiry.
- Worker search checkpoint: account, schema/index versions, source sequence/hash and serialized index. Discard/rebuild on mismatch; maintain separate default/Trash scopes without losing retained text.
- Note draft: parent identity, local edit sequence, draft text and last durable acknowledgment. Never clear on an unconfirmed persistence result.
- Runtime lease/checkpoint for capture/assets: bounded ownership claim, operation ID and generation. Multiple devices must not treat local leases as global locks.

## State and durability rules

A document is link-only when no usable text exists, partial when captured content is known/suspected incomplete, and readable when text is locally persisted. Asset completeness is separate. A failed image does not downgrade readable text to failed capture. Schema availability, local persistence, remote acceptance and runtime lifecycle are separate dimensions, not duplicate booleans that reconstruct actor state.

Write confirmation uses alpha.59 local durability waits. Global acceptance may be pending offline; rejection later must produce recoverable status and retain note drafts. A transaction groups related logical rows where supported; external asset acquisition is staged outside it. Local commit outcome uncertainty is reconciled by stable operation IDs before retry, not replayed blindly.

Concurrent duplicate captures may temporarily produce provisional records offline. On sync, a deterministic canonical identity winner (stable document ID ordering under verified identity key) gathers aliases/annotations without erasing source snapshots. Recheck invariants at writes and preserve unresolved merges for retry. Exact server constraints/transaction support must be qualified before this algorithm is considered implementation-ready.

## Anchor normalization contract

`clipper-text-v1`: visible readable text nodes in document order; exclude reader controls and hidden/non-content nodes; normalize line endings; decode HTML entities through inert parse; define deterministic separators for paragraph/heading/list boundaries and `<br>`; preserve internal text meaning. Each separator maps to a boundary in the final sanitized DOM. W3C offsets count Unicode code points; conversion maps to DOM UTF-16 offsets without splitting surrogate pairs/graphemes. Rules require fixture proof before v1 freeze.

Source-page capture has its own projection and scope. Its offsets are never applied blindly to the extracted projection. Match exact quote/context against target projection, validate unique result, persist derived anchor under target representation. Multiple plausible results → ambiguous; no exact reliable result → unresolved. Keep saved quote and notes readable in either outcome.

## Trash, permanent delete, and Undo

Trash preserves the full document graph with prior status; default searches filter the graph by parent document lifecycle. Restore clears Trash and returns prior status, tags, favorite and position. No expiry. An attempted duplicate of trashed source offers Restore, never auto-restores.

Permanent deletion requires confirmation naming article plus annotations; commit a durable owner-scoped deletion marker first, hide content immediately, then clean dependent rows/parts/index entries idempotently. Offline devices must honor the marker on reconnect instead of resurrecting data. Server/backup erasure guarantees are not claimed without provider policy verification.

Only highlight-delete Undo is in MVP. Keep a local bounded operation record containing highlight ID, note and tag/anchor references. Proposed 10-second availability, accessible dismiss/Undo, expiry does not delete unrelated annotations. Restoration preserves identities; intervening permanent parent deletion or authorization loss prevents restoration with a clear outcome. Broad tag/status/bulk Undo remains deferred.

## Partial capture retry boundary

Retry may enrich an incomplete initial capture under its existing document. Stage candidate text, verify durability and evaluate whether annotations already depend on the partial representation. Without annotations, replace the incomplete provisional representation before marking capture complete. With annotations, preserve their original quote/context and representation; never discard it while deriving the completed representation. This narrow initial-capture repair must not become general refresh/history UI; if implementation cannot maintain it safely, retain partial content and expose failure instead of corrupting annotations. This interaction remains an explicit proof case.
