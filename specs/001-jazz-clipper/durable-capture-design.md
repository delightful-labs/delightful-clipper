# Durable Add Link recovery

**Status:** Jazz-backed admission capability, 2026-11-03. PR #12 contains immutable intake/evidence records, bounded decoders and an XState admission owner. Reader PR #11 is merged into the branch through main at `aa36551`. The Add Link queue, retries and link-only UI remain unbuilt; FR-002/054/056/057 remain open.

## Persistence decision

Use existing native Jazz records for submitted URLs and durable capture evidence. Jazz already persists locally and exposes separate local/global write receipts. The account-scoped `captureIntakes` row is the durable intake journal; it does not need a duplicate URL, admission phase or revision in another database.

The earlier custom IndexedDB journal and its checkpoint contracts, compare-and-set leaves and cross-store barriers are removed. No concrete SDK limitation requires them for this capability. They introduced a second persistence protocol and a crash gap between native local settlement and checkpoint acknowledgment. There is no replacement custom store, localStorage marker or application-owned receipt database.

SDK evidence: the installed alpha.59 `WriteHandle` exposes `wait({ tier: 'local' })`, `wait({ tier: 'global' })` and a transaction ID. `ReadTier.LocalFirst` explicitly includes cached knowledge and pending writes. A normal record read does not recover the original write receipt. Retain this distinction instead of manufacturing durability or remote acceptance from row visibility. The implementation does not use protected SDK internals or add a DLF credential/persistence system.

The removed journal was used only by the previous test driver; the application Add Link workflow never wrote it. No automatic database deletion or migration of native intake rows is needed for this change.

## Existing record and ownership boundaries

| Record | Purpose | Invariants |
| --- | --- | --- |
| `captureIntakes` | Submitted URL, conservative fetch URL, creation time and format version under a stable intake UUID | Immutable; canonical-owner reads/inserts; no fake snapshot/asset required. Retain submitted fragments and query order. |
| `captureObservations` | Resolution evidence, stable failure classification or publication uncertainty for an intake/attempt | Immutable and same-library intake parent; bounded typed payload. An opaque payload is never accepted as completion. |
| `captureCompletions` | Accepted document reference for an intake/attempt | Immutable with required same-library intake and document parents. A failed attempt cannot overwrite a readable snapshot. |
| `storageOperations`, documents, snapshots and assets | Existing immutable publication intent and atomic readable snapshot graph | Reconcile the original publication identity. No refresh, replacement or blind replay of uncertain writes. |

Intake, observation and completion decoders validate exact shapes, account binding, UUIDs, versions, URL schemes/credentials/control characters and bounds. Observation JSON is capped at 32 KiB encoded UTF-8 and eight redirect hops. Malformed JSON errors do not echo stored payload contents. Authority policies enforce owner/parent relationships and immutable rows, not every domain payload constraint, so all future projection boundaries must use the decoders.

Clipper owns these schemas and policies. DLF owns session/recovery and the reusable transaction resource owner. DUI owns presentation. Preserve local-first startup, one-step saving, normal reader anchors and layout-owned workflow lifetimes. Images, annotations, organization, extensions and platform qualification remain separate work.

## Admission state and recovery contract

The admission actor receives one of two explicit commands:

- `new` carries a validated intake with a newly generated ID for an explicit fresh submission. It invokes the existing DLF-owned native transaction, waits for the local receipt and returns `admitted` with one separately observable global receipt. No capture network work is started by admission itself.
- `recover` carries only the original intake ID. It performs an owner-scoped validated Jazz read. A visible record returns `recovered` with its intake data and no write receipts. A missing/unavailable record returns `uncertain`; recovery never falls through to insertion or allocates another ID.

A fresh command whose native transaction finds an existing row also takes the read-only recovery path. A matching row returns `recovered`; a conflicting payload returns `blocked`. Definite pre-commit failure returns `failed`; unconfirmed commit/local settlement remains `uncertain`. An optimistic row is never promoted to newly confirmed local persistence or Synced.

```text
fresh submission -> validate -> native insert transaction -> local wait -> admitted + global receipt
                                                | blocked -> validated read -> recovered / blocked / uncertain
                                                | unresolved -> uncertain
restart/retry   -> validate original ID -> validated read -> recovered / uncertain
```

The caller must use recovery for a resumed or uncertain operation, not relabel it as a fresh submission. This contract does not claim exactly-once arbitration between two independently issued fresh commands. Future queue owners must coordinate execution and preserve operation identities. The earlier IndexedDB claim-winner test is removed rather than presented as a property of Jazz mergeable transactions.

On SHUTDOWN, the actor asks its DLF transaction child to stop and waits for acquisition, commit, local settlement and rollback as applicable. Scope loss prevents subsequent old-account work while allowing issued resources to settle. Terminal request buffers are cleared. A recovered result has no receipt field, preventing an empty receipt watch from being mistaken for global acceptance.

## Remaining execution recovery

Keep durable job evidence in Jazz records when D4 enters implementation. Do not reintroduce a separate database unless a specific required behavior and demonstrated SDK limitation justify it.

| Available evidence | Required behavior |
| --- | --- |
| Intake row is visible | Recover the original submitted URL; receipt/sync status remains separate. |
| Original intake ID is missing after an uncertain insert | Keep uncertainty; do not insert again or silently allocate another ID. |
| Readable document and valid same-owner graph exist | Link completion evidence to that document; preserve its snapshot. |
| Publication intent exists without a readable document | Reconcile the original operation; do not replay publication. |
| Earlier publication may have issued but current knowledge is incomplete | Preserve uncertainty; local absence is not rejection evidence. |
| Publication succeeded but completion evidence is missing | Reconcile existing content before adding completion evidence; never save a second snapshot as recovery. |

A durable intake survives process termination only after native local settlement. If storage fails before then, report failed/uncertain admission honestly; a second store does not make storage infallible. The interrupted-submission requirement does not promise recovery of an input that never reached durable persistence.

D4 still needs to model publication admission and execution ownership against these existing records before enabling autonomous recovery. Persist any new required scheduling/attempt metadata narrowly in the domain's native Jazz evidence; do not copy the intake into another checkpoint graph. Keep a runtime generation guard on child reports and recheck account/parent ownership after asynchronous boundaries. Same-origin execution coordination is not a cross-device lock. No automatic replay follows from an expired lease, a timeout, or an empty local query.

## Retry and presentation constraints

D3 must retain validated resolve/failure evidence, including available redirect observations and bounded Retry-After. The gateway currently returns classification that the client mostly discards. A canonical declaration alone never authorizes merging documents.

D5 allows capped exponential backoff with jitter, at most five automatic attempts per genuine wake/reconnect cycle and delays no longer than five minutes. Permanent input/security/authorization/source failures require corrective action or manual Retry. Coalesce connectivity notifications, preserve completed work and never let retry scheduling bypass publication reconciliation. Exhaustion retains the intake. No execution while the browser is closed is promised.

D6 will project link-only rows using literal source URLs, Open original and existing Retry labels. Reader URLs become available only for a verified readable document. Machines own localized workflow messages/severity. Existing article-saved/synced messages cannot label a merely visible intake as a readable or globally accepted article.

Two exact copy proposals remain **unapproved**; this simplification adds no catalog or inline UI text:

| Proposed key | Exact English; no variables/plural/context forms | Usage and catalog search result |
| --- | --- | --- |
| `capture.status.link_only` | Link saved on this device. Article content is unavailable. | Confirmed locally persisted intake with failed extraction. Existing saved/synced wording claims an article; fetch failure does not establish URL durability. |
| `capture.status.intake_failed` | The link could not be saved on this device. Try again before closing the app. | Failed admission. Existing article-save wording describes a later stage; fetch failure does not explain whether the URL was retained. |

Action/noun templates can label Retry/Open original but cannot express these persistence outcomes. `capture.errors.source_too_large` says “Nothing was saved” and must not be used after durable intake. Reuse approved messages only when accurate; request exact approval before adding or changing any needed wording.

## Implementation tasks and acceptance

- [ ] **D1 — Domain contracts and authority:** native intake/evidence contracts, bounded decoders and owner/parent policies are implemented. Finish future queue/projection boundaries and deployment qualification. Preserve successful document publication.
- [x] **D2 — Jazz admission capability:** native transaction leaves, explicit fresh/read-only recovery commands, local/global receipt separation, shutdown drain and terminal cleanup. No custom IndexedDB journal or checkpoint is required.
- [ ] **D3 — Typed source/failure evidence:** retain validated resolve provenance, partial redirect evidence, gateway failure class and Retry-After. Bound malformed/oversized response handling; preserve authenticated public-only transport.
- [ ] **D4 — Owned execution/reconciliation:** wire the capability into layout-owned queue/job actors; model native publication evidence, same-origin coordination, generation guards, account replacement and shutdown. Reconcile before retrying uncertain operations.
- [ ] **D5 — Scheduling:** implement bounded retry classification, budgets/deadlines, injected clock/jitter, connectivity coalescing and manual retry of the same intake. Persist required durable evidence in Jazz.
- [ ] **D6 — Library projection:** combine native intake/outcome and document rows, obtain required copy approval, and test failure-to-success, duplicate/destination changes, concurrent outcomes and rejection without fake readers or snapshot replacement.
- [ ] **D7 — Application qualification:** exercise UI capture termination/restart, cold production-shell recovery, reconnect retry, same-item completion, multi-tab takeover and restored-profile graph outcomes. Run repository verification, browser and production offline suites sequentially; record exact evidence limits.

The admission browser proof invokes the real capability through a test driver; it does not implement the Add Link queue. The production offline suite remains a reader/shell regression check until the queue is wired. Do not mark FR-002/054/056/057 complete from this capability.

## Simplification validation

`pnpm verify` passes 260 unit tests across 29 files and all vendor, formatting, lint, strict app/service-worker and production-build checks. All 13 Chromium tests and five production offline regressions pass, in sequence. Final formatting and diff checks pass. The lower counts remove tests for the deleted checkpoint protocol; native authority/decoder checks and admission uncertainty, receipt, scope and shutdown checks remain.

The driver-based admission browser proof stops the real authority, admits a native intake locally, closes the complete Chromium process, reopens the same profile and verifies the exact submitted URL. Recovery returns existing data without a receipt; a missing original ID returns uncertainty without insertion. The profile has no `clipper.capture-intake.1` database. Reconnection synchronizes the intake to an independently restored profile. This demonstrates native Jazz retention without the duplicate store, not UI queue recovery or a new platform guarantee.
