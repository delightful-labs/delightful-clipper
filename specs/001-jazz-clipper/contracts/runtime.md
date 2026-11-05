# Runtime, extension and worker contracts

**Updated**: 2026-11-04. Article saving and Chromium IPC below are implemented; annotation/note/image/search operations remain design contracts. TypeScript schemas in the source are authoritative for actual message shapes. See the handoff for platform evidence.

## Shared envelope

Commands/reports carry the identities and scope required by their boundary; do not add a universal metadata envelope or claim every current message has the same fields. Native article operations use stable operation IDs and bound capabilities; Chrome source references use version, UUID, tab/document IDs and observed URL; bar progress adds ordered revisions. Future annotation protocols must explicitly bind account/representation/request generations. Persistent account identifiers are not authorization credentials. Runtime attachment tokens stay nonserializable inside DLF integration. Ignore stale reports; validate payload schema, byte limits and sender origin before accepting external messages. Root account handles and recovery data never enter source-page code or extraction/image/search workers; the trusted SDK broker remains owned by the DLF/session integration.

## Host/domain boundary

| Capability | Input | Output and guarantees |
| --- | --- | --- |
| bindPrivateLibrary | DLF ready session/client capability, binding generation | owner-scoped repository; readiness is not proof of write permission or fresh remote data |
| saveArticle | URL and optional supplied content | native URL article/local receipt; readable content and remote acceptance reported separately; no second article-intake journal |
| resolveSourceIdentity | submitted URL + browser observations | validated destination/provenance/canonical evidence or recoverable unresolved result |
| persistSnapshot | capture/document ID, sanitized normalized output + native byte assets | stable snapshot reference after local durability; explicit remote pending/accepted/rejected |
| saveNote | parent identity, edit sequence, literal text | local acknowledgment for that sequence; separate remote sync report; draft retained on error |
| setStatus / setFavorite / assignTag | single target and desired value | idempotent desired-state write, not toggle replay |
| trash / restore | single document, operation ID | retained graph and prior status; no implicit duplicate restore |
| permanentDelete | confirmed document graph, operation ID | durable tombstone then resumable cleanup; no cross-account deletes |
| deleteHighlight / undoHighlightDelete | annotation or local undo operation | same identities restored when eligible; parent tombstone/access rechecked |
| observeLibrary / observeAnnotations | account binding and scope | labeled view models, no Jazz handles exposed to presentation |
| recordPosition | document/representation, locator, interaction identity | local save; received remote observations never scroll active reader |

## Trusted extension protocol

The current protocol is defined in `apps/extension/src/protocol.ts` and enforced by background/runtime state machines:

- The toolbar action is the entry point; there is no source-page capture RPC bridge. Admission requires a scoped explicit confirmation plus a matching actual SDK account; otherwise a trusted sign-in popup is opened.
- Background → offscreen: `AUTHORIZE` with the confirmed account ID, followed by `RUN` with reference/account IDs only after admission; trusted `ACCOUNT_CHANGED` forwarded from Options. Sender validation admits the extension background, not arbitrary pages.
- Offscreen → background: `CAPTURE` for the validated source reference, `ISSUE` before native dispatch, `REMOVE` after local publication, `WAITING` for account-owner feedback and `PROGRESS` for clip/receipt feedback. Only the trusted offscreen page can mark or remove references or report statuses.
- Trusted sign-in/Options UI → background: `CONNECT` only after a completed restoration. Background persists the account/app/server confirmation before notifying the runtime with `ACCOUNT_CHANGED`. A ready identity alone does not establish a connection; credentials stay in trusted DLF UI.
- Background → source: document-targeted credential-free serialization and bar projection. Bar messages are literal text/safe links, correlated by capture ID/revision; Close never initiates a native operation. Untrusted captured HTML is never rendered in extension UI.

One offscreen document owns the SDK/application session and extraction workers; the sleeping MV3 background is not the SDK lifetime owner. Bounded Chrome references contain source metadata and a pre-dispatch issued marker, not captured HTML. Native intent/publication records own article durability and unknown-write recovery. Restart does not rehydrate and replay old writes, and lost dispatch acknowledgements are not treated as definite failures.

Future annotation commands (`CREATE_HIGHLIGHT`, `GET_ANNOTATIONS`, resolved-range reports) still require account/source/representation-bound design and tests. They are not accepted by the shipped protocol and must not be described as implemented.

## Worker interfaces

| Worker | Request | Reports |
| --- | --- | --- |
| extract | bounded serialized markup, effective base URL, parser/normalization versions | normalized candidate HTML/text/headings/footnotes/resource candidates, partial evidence, or typed parser failure |
| image | transferable bytes, verified media type, decode/size/encoding limits | processed transferable bytes, dimensions/hash, unsupported/oversized/decode failure |
| search | account-scoped source delta/checkpoint; query/filter/scope | checkpoint and labeled hits with snippet ranges; stale-generation results discarded |

Extraction adapters must prove DOM compatibility. Browser-native DOM sanitization before render is a narrow presentation boundary if safe worker sanitization is unavailable; it does not authorize performing the full extraction/index pipeline in a Svelte component. Account replacement terminates workers and clears indexes/byte buffers; revoke blob URLs on reader teardown.

## Search/filter semantics

Plain keywords, AND by default, no query language or fuzzy matching UI. Search article title/body, highlight quote and both note texts. Results identify source record and document. Status/favorite filters on annotation results use the parent document; a tag filter requires the result article/highlight's explicit assignment. A note result uses its note parent's assignment (article or highlight), not both ancestral levels. Selecting a tag shows articles/highlights explicitly assigned it. Trash scope explicitly switches to trashed graph; default excludes it. Global tag rename collisions return a conflict and do not silently merge tags.

## UI/localization contracts

UI sees literal note text, safe link parts and view-model status descriptors. Linkify only HTTP(S), escape all literal content, preserve standard navigation and browser new-tab gestures. Reader DOM uses stable content projection boundaries; controls/footnote popovers remain outside anchor text. Fonts are bundled/available choices; no custom font upload or named presets. Owning machines call i18next and expose ready-to-render text/severity; components must not map workflow codes to translation keys. Do not persist translated text as durable domain errors, and do not add/change catalog wording without explicit user approval under localization memory.

## Error and outcome vocabulary

`invalidInput`, `permissionDenied`, `sessionUnavailable`, `offlinePending`, `redirectBlocked`, `redirectLoop`, `fetchTimeout`, `sourceUnavailable`, `parseFailed`, `partialContent`, `quotaExceeded`, `decodeFailed`, `localWriteFailed`, `syncPending`, `syncRejected`, `ambiguousAnchor`, `unresolvedAnchor`, `canceled`, `unknownWriteOutcome`.

Classify once at the boundary; errors carry no recovery secrets, raw credential URLs or page HTML in logs. A failed initial capture retains URL/retry; no failure path deletes a completed snapshot.
