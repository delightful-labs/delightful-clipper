# Clipper logical data model

**Updated**: 2026-11-06. Logical model for the full accepted product, not a claim that every row below exists. Native schemas and owner policies are implemented in `apps/web/src/lib/backend/jazz`; PR #19 now includes independent note entities, linked revisions and note-keyed recovery drafts. Highlight entities/workflows, the note editor and AT Protocol integration remain unimplemented. See tasks.md and the handoff for other implementation evidence.

## Identity and authorization

Every source-of-truth row carries or inherits an enforced `libraryId`/owner relation. The library belongs to one DLF/Jazz account. Every client read/write and native asset relationship must enforce the same owner server-side; UI filters are insufficient. Tags, annotations, snapshots and assets cannot reference another owner's rows. No public grants or collaborative roles are introduced.

## Records

| Record | Important fields | Relationships / invariants |
| --- | --- | --- |
| Library | ID = authenticated account UUID, immutable owner ID and bootstrap format 1 | One canonical root per account; idempotently ensure only this immutable payload. Empty replicas never trigger another identity or random root ID; mutable data/migrations are separate. |
| Document | ID, libraryId, originalSavedAt, title/author, status, favorite, trashedAt?, priorStatus?, snapshotId?, captureState | Status is Inbox/Later/Archive. Trash is separate lifecycle. Saved snapshot immutable; no refresh selector. Original save time orders list newest first and does not change on re-clip. |
| Article | ID, libraryId, url, originalSavedAt, contentId?, operationId?, failure? | Primary URL-first object; optional immutable content reference. Retry preserves identity/time. Bound uncertain publication is not replayed. |
| SourceIdentity | ID, libraryId, normalized accepted URL key, documentId, evidence kind/time, redirect target? | Preserve raw observed aliases separately. Revalidate shortening destinations. Duplicate reconciling must retain annotations and captures. |
| Representation | ID, documentId, kind source/reader, normalizationVersion, selectorVersion, textHash, textLengthCodePoints, native sanitized payload, heading/footnote metadata | A successful reader snapshot is fixed in MVP. Source representation may retain selectors/quote/provenance rather than a full duplicate raw page. No historical revision UI required. |
| Asset | ID, documentId, sourceURL, mediaType, byteCount, width/height?, content fingerprint when needed, native byte payload, processingVersion | Content-addressed only within owner scope; reference tracking prevents deleting bytes needed by another retained record. |
| Highlight (annotation) | ID, libraryId, article link, originalQuote, createdAt, deletedAt?, defaultColor? | Independent entity with its own stable identity and explicit article association. One color in MVP, optional metadata supports future colors. One logical annotation can have multiple rendered spans and representations. Overlaps never merge. No resize command. |
| Anchor | ID, annotationId, representationId, selectors, normalizationVersion, status resolved/ambiguous/unresolved, derivedFrom? | W3C-compatible quote exact/prefix/suffix and code-point start/end; optional internal DOM path. Original selectors immutable. Deriving a reader anchor does not overwrite source evidence. No candidate repair workflow. |
| Note | ID, libraryId, article link, optional highlight link, content, editedAt, deletedAt? | Independent entity with its own stable identity. Article association is a relationship rather than the note's identity. One active editable note per parent remains a cardinality rule; concurrent creation needs separate reconciliation. Plain text, linkification at view. Retain conflicting text until reconciled rather than last-write overwrite loss. |
| NoteRevision | ID, libraryId, noteId, text, causal parent revision IDs, editedAt | Current immutable full-text conflict storage. Content belongs to an independently identified note; revision IDs and timestamps cannot replace the note's identity. Concurrent heads are retained until explicitly reconciled. |
| Tag | ID, libraryId, displayName, normalizedKey, deletedAt? | Trim outer whitespace; case-insensitive identity. Proposed Unicode NFC + locale-independent fold/version; implementation must qualify non-ASCII collisions before schema lock. Rename collision fails clearly rather than silently merge. |
| TagAssignment | ID, tagId, targetType article/highlight, targetId | Unique relation, no inherited parent/child assignment. Global deletion removes/hides assignments including Trash. |
| ReadingPosition | ID, account/document/representation/device, logical locator, quote/context?, lastInteractionAt, operationId, furthestLocator? | Per-device observations prevent sync write storms. Pick latest observed timestamp with deterministic operation-ID tie-breaker; clocks are imperfect. Apply only when opening, never jump an active article. Progress and last location separate. |
| ReaderPreferences | ID, account, theme Light/Dark/System, fontFamily, fontSize, lineSpacing, readingWidth | Shared preferences with local cached value. No named presets, width matching, custom font upload, or per-device overrides. |

## AT Protocol identity boundary

Research follow-up (2026-11-07): [AT Protocol highlights and notes research](../../docs/atproto-research.md)
compares public Lexicons, private Spaces, anchoring, offline reconciliation and DLF/backup ownership.
It consolidates accepted publication behavior and companion fields, with unapproved mechanics
kept separate. Jazz upgrade and backend hosting are being handled independently; this research
does not authorize implementation or migration.

AT Protocol support is confirmed product intent; the original planning conversation did not carry it into this specification. Notes and highlights therefore need their own records and identities, with explicit article relationships, regardless of the eventual AT storage/publication choice. The article must not be the only address through which an annotation can be retrieved. A note attached to a highlight has its own identity, not the highlight's identity.

AT Protocol addresses records with an AT URI containing repository identity, collection and record key. A version-specific strong reference additionally carries a CID; record address and content version are different concepts. See the official [data repository guide](https://atproto.com/guides/data-repos) and [AT URI specification](https://atproto.com/specs/at-uri-scheme). DLF owns shared identity integration and the broader cross-app AT Protocol boundary, starting with identity. Clipper domain IDs must remain independent of DIDs, provider subjects, AT record keys and content-version identifiers. No Lexicon namespace, record-key format, source-of-truth or publication lifecycle is selected here; those choices are not prerequisites for modeling independent local entities. A portable article reference also needs design because a private Jazz article ID alone is not an externally resolvable source reference.

PR #19 now implements independent `notes` and linked `noteRevisions`; `articleNoteRevisions` remains read-only legacy evidence, with an explicit preserving import operation. Recovery storage keeps old article-keyed drafts until an atomic, validated move to a particular note ID succeeds. The note editor must consume those migration capabilities before editing old content. Retaining full-text revision history versus another qualified conflict-safe text model remains an implementation decision to review; AT Protocol integration does not require exporting the internal revision graph. Existing private-library behavior remains intact. Clipper must consume DLF identity capabilities rather than adding its own account-linking system; future shared transport/publication behavior can be designed separately without using the article or current account-provider identity as the note/highlight record identity.

## Device-local records (not synced authority)

PWA Add Link saves native `articles` directly, with optional content through the same operation. Existing immutable documents/snapshots/assets hold readable content. A dedicated worker processes missing-content articles serially. No separate intake graph or IndexedDB journal is selected. See [durable-capture-design.md](durable-capture-design.md). Pre-session external intake remains a distinct future boundary.

- Availability ledger keyed by account/representation/asset: native row availability and local write settlement; derive offline-complete only when required native text/byte values are locally available.
- Chromium source references: at most eight small Chrome-storage records containing version/ID, tab/document, URL and ready/issued phase, with account ID on issued markers. They hold no article HTML or credentials and are not a second article database. The trusted offscreen runtime waits for identity, serializes saves and never replays issued references. Pre-session mobile-share handoff remains a separate future qualification; never silently attach old-account work to a new account.
- Worker search checkpoint: account, schema/index versions, source sequence/hash and serialized index. Discard/rebuild on mismatch; maintain separate default/Trash scopes without losing retained text.
- Note drafts use independent note identity, local edit sequence, draft text, base revision IDs and exact durable acknowledgment. Parent association comes from the note entity. The old article-keyed store is retained until validated atomic recovery to an explicit note ID completes. Never clear on an unconfirmed persistence result.
- Same-profile web capture uses Web Locks; Chromium extension launch/save queues and offscreen lifetime are implemented. Future asset coordination still needs qualification. A local lock/lease is not a global lock, and does not authorize replay of an uncertain native operation. No separate durable checkpoint store is selected for PWA capture.

## State and durability rules

A document is link-only when no usable text exists, partial when captured content is known/suspected incomplete, and readable when text is locally persisted. Asset completeness is separate. A failed image does not downgrade readable text to failed capture. Schema availability, local persistence, remote acceptance and runtime lifecycle are separate dimensions, not duplicate booleans that reconstruct actor state.

Write confirmation uses alpha.59 local durability waits. Global acceptance may be pending offline; rejection later must produce recoverable status and retain note drafts. A transaction groups related logical rows where supported; external asset acquisition is staged outside it. Local commit outcome uncertainty is reconciled by stable operation IDs before retry, not replayed blindly.

Concurrent duplicate captures may temporarily produce provisional records offline. On sync, a deterministic canonical identity winner (stable document ID ordering under verified identity key) gathers aliases/annotations without erasing source snapshots. Recheck invariants at writes and preserve unresolved merges for retry. Exact server constraints/transaction support must be qualified before this algorithm is considered implementation-ready.

## Anchor normalization contract

`clipper-text-v1`: visible readable text nodes in document order; exclude reader controls and hidden/non-content nodes; normalize line endings; decode HTML entities through inert parse; define deterministic separators for paragraph/heading/list boundaries and `<br>`; preserve internal text meaning. Each separator maps to a boundary in the final sanitized DOM. W3C offsets count Unicode code points; conversion maps to DOM UTF-16 offsets without splitting surrogate pairs/graphemes. Rules require fixture proof before v1 freeze.

Source-page capture has its own projection and scope. Its offsets are never applied blindly to the extracted projection. Match exact quote/context against target projection, validate unique result, persist derived anchor under target representation. Multiple plausible results → ambiguous; no exact reliable result → unresolved. Keep saved quote and notes readable in either outcome.

## Trash, permanent delete, and Undo

Trash preserves the full document graph with prior status; default searches filter the graph by parent document lifecycle. Restore clears Trash and returns prior status, tags, favorite and position. No expiry. An attempted duplicate of trashed source offers Restore, never auto-restores.

Permanent deletion requires confirmation naming article plus annotations; commit a durable owner-scoped deletion marker first, hide content immediately, then clean dependent rows/assets/index entries idempotently. Offline devices must honor the marker on reconnect instead of resurrecting data. Server/backup erasure guarantees are not claimed without provider policy verification.

Only highlight-delete Undo is in MVP. Keep a local bounded operation record containing highlight ID, note and tag/anchor references. Proposed 10-second availability, accessible dismiss/Undo, expiry does not delete unrelated annotations. Restoration preserves identities; intervening permanent parent deletion or authorization loss prevents restoration with a clear outcome. Broad tag/status/bulk Undo remains deferred.

## Partial capture retry boundary

Retry may enrich an incomplete initial capture under its existing document. Stage candidate text, verify durability and evaluate whether annotations already depend on the partial representation. Without annotations, replace the incomplete provisional representation before marking capture complete. With annotations, preserve their original quote/context and representation; never discard it while deriving the completed representation. This narrow initial-capture repair must not become general refresh/history UI; if implementation cannot maintain it safely, retain partial content and expose failure instead of corrupting annotations. This interaction remains an explicit proof case.

Native storage boundary (PR #5): Jazz owns byte representation, transfer and storage integrity. Clipper owns bounded domain validation, parent relationships, publication and uncertain-operation reconciliation. The initial publication transaction inserts snapshot, asset and document atomically after its operation journal; no application-level blob parts or compression protocol is selected.
