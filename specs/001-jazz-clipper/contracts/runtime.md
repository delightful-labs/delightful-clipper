# Runtime, extension and worker contracts

**Status**: proposed typed boundaries; SDK bindings require plan G1–G5 proof. Not implementation code.

## Shared envelope

Every command/report includes `protocolVersion`, `requestId`, `operationId`, nonsecret `accountBinding`, and `generation`. Persistent account identifiers are not authorization credentials. Runtime attachment tokens stay nonserializable inside DLF integration. Ignore stale reports; validate payload schema, byte limits and sender origin before accepting external messages. Root account handles and recovery data never cross content scripts or workers.

## Host/domain boundary

| Capability | Input | Output and guarantees |
| --- | --- | --- |
| bindPrivateLibrary | DLF ready session/client capability, binding generation | owner-scoped repository; readiness is not proof of write permission or fresh remote data |
| journalCapture | URL or bounded rendered HTML, entry point, operation ID | locally durable intake ID before caller view closes |
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

Content → background/UI: `CAPTURE_REQUEST`, `CREATE_HIGHLIGHT`, `GET_ANNOTATIONS`, `OPEN_CLIPPER`, bounded page URL/title/base, serialized selected quote/positions, captured markup where needed. Highlight commands target observed source plus account binding; no arbitrary repository method names or executable strings.

Background → trusted UI: `INTAKE_AVAILABLE`, `FETCH_RESULT`, `PERMISSION_REQUIRED`, `RUNTIME_UNAVAILABLE`. Source permissions are requested through a user action; deny produces a useful pending/link-only state. Browser messages verify extension sender/tab/document; host webpage `postMessage` alone is insufficient authority.

Trusted UI → content: sanitized annotation summaries and explicit resolved ranges for that tab's document; link state and capture status. Never write arbitrary captured HTML into extension privileged UI. Opening the trusted app is explicit and labeled; extension clipping does not automatically navigate away.

A bounded persistent journal survives MV3 suspension. Rehydrate active operations from journal on runtime wake. A stopped service worker is not evidence that an issued fetch/write was canceled. Cancellation retains acquired resources until cleanup settles. No blanket remote code or remote-eval dependency in the extension package.

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

UI sees literal note text, safe link parts and view-model status descriptors. Linkify only HTTP(S), escape all literal content, preserve standard navigation and browser new-tab gestures. Reader DOM uses stable content projection boundaries; controls/footnote popovers remain outside anchor text. Fonts are bundled/available choices; no custom font upload or named presets. Shared i18next descriptors include key/args; no translated text cached as durable domain errors.

## Error and outcome vocabulary

`invalidInput`, `permissionDenied`, `sessionUnavailable`, `offlinePending`, `redirectBlocked`, `redirectLoop`, `fetchTimeout`, `sourceUnavailable`, `parseFailed`, `partialContent`, `quotaExceeded`, `decodeFailed`, `localWriteFailed`, `syncPending`, `syncRejected`, `ambiguousAnchor`, `unresolvedAnchor`, `canceled`, `unknownWriteOutcome`.

Classify once at the boundary; errors carry no recovery secrets, raw credential URLs or page HTML in logs. A failed initial capture retains URL/retry; no failure path deletes a completed snapshot.
