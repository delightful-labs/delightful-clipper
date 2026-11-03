# Durable Add Link recovery

**Status:** admission capability and implementation design, 2026-11-03. Immutable intake/evidence tables, bounded record decoders, native transaction leaves, an account-scoped IndexedDB admission journal and its XState owner are implemented. The application capture queue, publication recovery, retry scheduler and link-only UI are not wired. The complete workflow addresses FR-002, FR-054, FR-056 and FR-057; those acceptance gaps remain open.

## Scope and existing constraints

Retain a valid submitted Add Link before starting network work. Restore pending work after process termination, retain a failed capture as a link-only library item, and retry into that same logical item or an existing verified destination. Keep current one-step saving, dedicated reader URLs, layout-owned actors and explicit Open. Images, extension/share intake, annotations, refresh, organization and deletion remain separate batches.

The workflow design was traced against `a8d9df3` on `feat/structured-saved-reader`, not the archived prototype. PR #11 has since merged into `main` at `aa36551`; that main baseline is incorporated into `feat/durable-capture-foundation`, PR #12. Keep its dedicated readers, one-step Add Link and local-first startup corrections. Do not merge PR #12 without authorization; recheck its live state before further work.

Existing code imposes several concrete constraints:

- `backend/jazz/schema.ts` and `permissions.ts` make documents immutable, with required snapshot and asset parents. Do not insert empty snapshots or change this shape to pretend a failed link is readable.
- `capture/source.ts` derives article/publication identity from the owner and verified final URL. A submission ID is a different identity: a short URL may resolve to different destinations later. Preserve the submitted fragment separately from the normalized fetch URL.
- `machines/storage/save.ts` owns intent and publication transaction actors. A persisted `storageOperations` row without a document is already uncertain, and must block replay. Do not turn a local query miss into proof that an earlier write was rejected.
- `machines/runtime/application-readiness.ts` waits for the library owner before restoring, logging out, replacing a binding or shutting down. Extend that drain boundary rather than creating a second session owner.
- `machines/capture/library.ts` currently owns one transient capture. Its reader region is parallel and must remain independent of capture recovery.
- `backend/jazz/library.ts` collapses most HTTP failures into `captureFailed`, while the gateway already returns `code` and `retryable`. Durable retry needs a validated failure envelope, not a policy based on exception messages or `navigator.onLine` alone.

## Identities and persistence

Use native Jazz rows for account-visible submission and outcome evidence. Use a device-local execution checkpoint for scheduling and the publication barrier. Keep the device-local store separate from shell Cache Storage; never cache private URL responses in the service worker.

| Record | Fields and ownership | Invariant |
| --- | --- | --- |
| `captureIntakes` | Immutable `id` (random UUID), `libraryId`, raw `submittedUrl`, conservative `fetchUrl`, `createdAt`, `formatVersion` | One logical library item per submission. Locally persist before any resolve/extract call. No snapshot/asset reference is required. |
| `captureObservations` | Immutable `id`, `libraryId`, `intakeId`, `attemptId`, `kind`, bounded versioned `payload`, `createdAt`, `formatVersion` | Append provenance, failures and uncertainty without replacing a successful snapshot or erasing earlier evidence. The intake must belong to this library. |
| `captureCompletions` | Immutable `id`, `libraryId`, `intakeId`, `attemptId`, required `documentId`, `createdAt`, `formatVersion` | Same-owner intake and document relations are checked by authority policies. This table carries completion references; an observation payload is never sufficient evidence of completion. |
| Local execution checkpoint | Key `(libraryId, intakeId)`; version, attempt UUID, runner generation, state, attempt budget, next eligible time, resolved observation, optional bounded candidate, publication operation ID and barrier state | Account-bound, same-origin coordination state; contains no bearer, recovery phrase, SDK handles or translated text. IndexedDB transaction completion establishes local durability. It is not a remote receipt. |

The observation payload will be a discriminated, validated domain union: resolution evidence; capture failure with stable code/retry class; or publication uncertainty. Completion references live in `captureCompletions`. Store raw source observations separately from accepted identity. A canonical declaration remains a candidate, never an accepted alias without the existing equivalence proof.

Failures before resolution still retain the original URL. Failures after resolution retain the last validated final URL, redirect chain and observation time. Preserve partial redirect observations when the gateway can safely return them; bound them using the existing eight-hop and URL-length limits. Extend the versioned capture HTTP contract and tests rather than accepting arbitrary error JSON as provenance. Existing `resolvedUrl()` only returns a URL and must be replaced or supplemented with a bounded typed observation.

Do not synchronize an active execution lease or treat a device clock as a global lock. A restored profile sees link-only/outcome evidence but does not automatically rerun every historical pending intake. Automatic recovery runs for locally checkpointed work; explicit Retry on another profile creates a local execution checkpoint for the same intake. Retain all concurrent attempt evidence. Same-document publication still uses the existing deterministic destination ID and immutable intent checks; global duplicate arbitration is not newly claimed.

### Authority policies and bounds

Allow intake/observation/completion reads only through the owning canonical library. Allow intake insert only for that owner. Deny updates and deletes for all three new tables in this batch. Observation insert requires an existing intake in the same library; completion insert additionally requires a document in that same library. The implemented mapping uses a separate completion table with a required document relation, avoiding a conditional parent hidden inside JSON. All three tables require format version `1` on insert. Authority tests prove these relationships, valid same-transaction parent insertion and atomic rejection of a forged graph.

The tables enforce owner/parent relationships and format version, not URL syntax, payload discriminants or application size limits. `capture/intake.ts` now supplies exact-shape owner-bound decoders for intakes, observations, completions and admission checkpoints; native adapter reads and stages use them. URL normalization preserves submitted fragments/query order and rejects credentials, unsupported schemes and controls. Observation JSON is capped at 32 KiB encoded UTF-8, with at most eight bounded redirect hops; malformed JSON errors do not echo payload contents. No production capture path writes these rows yet. Future queue/projection boundaries must use these decoders too; arbitrary owner-inserted `kind` or JSON values are not trusted state.

Validate payload formats, UUIDs, URL schemes/credentials, lengths and supported versions in Clipper at every ingestion/projection boundary. Use existing URL, provenance, text and byte bounds. Do not serialize unbounded HTML in an observation. The candidate checkpoint uses existing text/HTML limits plus a total encoded-record bound. Limit runnable concurrency to one per account/runtime initially and enumerate durable work in bounded pages; never discard retained entries to meet a processing limit. Storage denial or quota failure prevents admission and leaves the input available for Retry.

Jazz intake receipts and observation receipts have independent local/global outcomes. A remote rejection must remain visible and must not erase the local checkpoint or candidate. Do not report the link as synchronized because its eventual document synchronized, or vice versa.

## Owner and state contract

The application layout retains the DLF session and library owner. The library owns a capture queue actor, subscriptions and one active job actor. Job actors own abortable resolve/extract reads, checkpoint I/O and a spawned existing save actor. Adapters expose individual I/O operations; components send commands and render machine-provided messages.

```text
admitting -> journaled -> reconciling -> resolving -> checking destination
                                                   -> extracting -> checkpoint candidate
                                                   -> reconcile final destination
                                                   -> publication barrier -> existing save actor

transient network failure -> link-only + waiting/backoff -> reconciling
permanent failure        -> link-only + manual Retry   -> reconciling
known document           -> completed reference
issued/uncertain write   -> reconciliation only; no publication replay
shutdown/scope loss      -> abort reads, drain issued writes, retain checkpoint
```

Admission has two durable stages: create the local checkpoint with the raw URL and account binding, then persist the Jazz intake locally. Only after both settle may the job start network work. Termination between these stages recovers by reconciling the same intake ID. Never allocate another ID because admission completion was not observed. An uncertain Jazz intake insert requires reconciliation, not blind insert replay; the local checkpoint still preserves the URL.

The implemented admission subset is `pending → issuing → admitted`. Native IndexedDB transactions use strict durability, complete before their leaf returns, and close their connection afterward. A compare-and-set checks revision, phase, attempt and immutable intake fields; a competing claim cannot grant a second writer. Enumeration is account-keyed and limited to 100 records per page. Unknown formats/phases fail closed without deletion or replacement. The owner drains issued local writes and the DLF-owned native transaction on SHUTDOWN, clears terminal request/checkpoint buffers and returns local/global receipts separately. This is admission only: job generations, leases, candidate checkpoints and publication/retry phases belong to D4–D5.

An important conservative boundary: `ReadTier.LocalFirst` can return optimistic native rows. A matching read alone cannot promote an `issuing` checkpoint to `admitted`. The current capability requires its own successful local receipt and final durable checkpoint, or a matching previously `admitted` checkpoint plus current matching row. Otherwise it returns `uncertain`, even when the row is visible, and does not replay. Recovery of native local settlement followed by a lost checkpoint acknowledgment still needs additional qualified evidence in D4; do not silently turn a read into a write-durability guarantee.

Before publishing, durably store a barrier identifying the intake, attempt, destination operation ID and candidate fingerprint. Only the live actor that successfully created that barrier may start the save child. Rehydrating an existing barrier grants reconciliation permission only. This deliberately permits a conservative uncertain state if termination happened after the barrier but before the first save write. It never permits an uncertain write to be replayed.

Checkpoint completions and child reports carry account binding, owner generation, intake ID and attempt ID. Recheck all four after every asynchronous boundary. A stale completion may settle its own already-issued resource but cannot update the new owner's view or issue another write. Do not trust A → B → A account UUID equality without a binding generation.

On graceful shutdown, stop admission and timers, abort network/reads, and drain checkpoint writes and the existing save child before completing the library actor. Keep the old SDK binding usable for issued-write settlement until the existing application drain completes. Stop subscriptions, clear candidate buffers and detach connectivity listeners. On abrupt termination, recovery comes from prior durable stages; `beforeunload` is not the journal.

Cancel stops the current attempt and automatic scheduling but retains the intake, evidence and any issued-write uncertainty. Retry targets that same intake; it is not an ADD command with a fresh ID. Normal route navigation does not stop the queue or job actors.

## Restart and publication reconciliation

| Recovered evidence | Permitted next action |
| --- | --- |
| Local checkpoint exists; Jazz admission definitely not issued | Persist the original intake ID, then continue. |
| Jazz admission may have issued; local row missing | Retain URL and uncertain admission state. Reconcile original ID; no blind insertion or new ID. |
| Intake durable; no publication barrier | Resolve again, retaining earlier observations. Reuse a bounded checkpoint candidate only after validating its version, fingerprint and identity evidence. |
| Matching readable document exists | Append completion evidence for that document, then mark the local job complete. Never replace its snapshot. |
| Storage intent exists without document | Retain uncertain publication. Query/reobserve the original operation; do not spawn save. |
| Publication barrier exists, but neither document nor intent is locally visible | Retain uncertainty. Local absence does not prove the issued operation failed. Do not clear the barrier on timeout or connectivity change. |
| Save settled locally but completion observation did not | Reconcile document/parents, append completion evidence, and finish the same intake. No second save. |
| A write was authoritatively rejected | Retain evidence and local recovery content. Do not automatically allocate a fresh publication ID to bypass rejection or immutable-operation rules. |

Document verification includes owner/parent consistency and readable text, using the existing read capability; a bare unvalidated document header is insufficient to announce readable recovery. A temporary missing asset does not erase persisted text. Completion observation uncertainty must not undo document success or trigger another capture.

Link-only is a projection of a durable intake without a verified completed-document reference. Its failure reason and retry affordance are separate from synchronization status. A completed reference suppresses earlier failed attempts in the main list but retains their provenance. Concurrent successful attempts resolving to different destinations remain separate evidence; do not select a winner by timestamp and silently lose a document. The exceptional projection must retain access to both results, with reconciliation remaining explicit.

## Retry policy

Classify at the transport/protocol boundary, persisting domain codes rather than English exceptions. An explicit abort, scope replacement or gateway-disabled deployment does not start automatic backoff. Invalid input, prohibited destination, authorization denial, unsupported source/media, parser/content failure and size-limit failure require corrective action or manual Retry. A gateway's `retryable` flag is necessary evidence, not permission to retry a permanently classified code.

Network failure, bounded gateway timeout, temporary upstream unavailability and rate limiting may schedule automatic retry. Malformed/unknown responses fail closed to manual recovery. Use a validated and bounded `Retry-After` for rate limiting; cap automatic delays at five minutes. Do not downgrade a security error to connectivity failure because the browser reports offline.

Allow at most five automatic attempts per runtime wake or genuine offline → online cycle. Initial submission and explicit Retry are user attempts, not hidden automatic attempts. Use exponential delays based on one second with equal jitter in `[base/2, base]`, doubling each automatic attempt and capping at five minutes. A bounded `Retry-After` can raise that delay, still capped. Persist the consumed attempt budget and next eligible time before issuing the attempt. A timer callback alone cannot authorize an attempt.

Coalesce online/focus notifications; focus and duplicate online events do not replenish the budget. Resume only when the runtime is attached, the account binding is current, the operation has no uncertain publication, and the persisted deadline has elapsed. A fresh wake can establish one new cycle after reconciling prior work; it does not replay write barriers. Treat browser connectivity as a scheduling hint, not proof that the gateway or authority is reachable. Exhaustion retains the link and manual Retry; it does not spin or delete work.

For same-origin tabs, acquire one account-scoped execution lock before enumerating or advancing checkpoints. A losing tab observes the shared result. Do not hold unrelated account or reader locks. If the selected lock primitive is unavailable, disable automatic execution on that unqualified platform rather than inventing a timed lease that could overlap an issued write. Qualify lock release on process death and takeover before claiming multi-tab safety. A local lock provides no cross-device guarantee.

## Presentation and copy approval

Keep saved readers unchanged. Render link-only entries as literal source URLs with normal Open original anchors and existing `actions.retry`; never expose a reader link until a verified readable document exists. Avoid injecting URLs into HTML. A locally checkpointed URL is not yet a Jazz-synchronized link. Do not reuse `capture.status.saved` or `capture.status.synced` for it.

The catalog search found reusable pending, saving, uncertain, rejection, duplicate, generic fetch failure, authentication, rate-limit, invalid-URL, Retry and Open original wording. `capture.errors.source_too_large` says “Nothing was saved” and is incorrect after durable admission; retain its current wording for existing behavior and use the generic failure reason for a link-only size failure until a specific replacement is approved. The machine must supply all status/failure text and severity.

Two proposed messages were submitted for explicit approval in the continuation thread; **approval is pending**. Do not add them to the catalog or use inline English until approved:

| Proposed key | Exact English; no variables/plural/context forms | Usage and why existing entries do not work |
| --- | --- | --- |
| `capture.status.link_only` | Link saved on this device. Article content is unavailable. | A locally persisted Jazz intake with failed extraction. Existing saved/synced entries claim a readable article; generic fetch failure does not establish retained URL durability. |
| `capture.status.intake_failed` | The link could not be saved on this device. Try again before closing the app. | Admission failed before the URL became durable. Existing article-save failure describes a different stage; fetch failure says nothing about preserving the submitted URL. |

Action/noun templates can label Retry/Open original but cannot express these persistence outcomes. Keep per-entry reasons as separate machine-owned messages. Review additional states during implementation; if another message is necessary, search and request exact approval before adding it. This design is not catalog approval.

## Dependency-ordered implementation and acceptance

- [ ] **D1 — Domain contracts and authority:** intake/observation/completion contracts and admission-checkpoint bounds/decoders are implemented with authority and malformed-data tests. Finish application projection boundaries and deployment qualification before enabling the workflow; extend understood checkpoint phases with D4–D5. Existing successful documents remain unchanged.
- [x] **D2 — Durable admission capability:** account-scoped IndexedDB checkpoint leaves and native Jazz intake/observation/completion transaction actors reuse the DLF resource owner. Admission owns the issuance barrier, local receipt and final checkpoint; tests cover local/global separation, storage denial, unknown outcomes, shutdown drain, terminal cleanup and native process restart. The leaf capability is exposed through library records; the actual Add Link/queue still needs D4 wiring and D7 acceptance.
- [ ] **D3 — Typed source/failure evidence:** retain validated resolve provenance and gateway failure class/Retry-After. Extend HTTP contracts and fixtures for pre-resolution failure, redirects followed by failure, parser failure, bounded response validation and malicious provenance. Preserve public-only transport and request authentication.
- [ ] **D4 — Owned execution and reconciliation:** add queue/job XState actors, same-origin execution coordination, generation guards and durable publication barrier. Reuse the save child and receipts. Test termination/checkpoint recovery at every table above, no uncertain-write replay, A → B → A replacement, navigation during capture and reader independence. Keep incomplete/unsupported checkpoint versions recoverable without executing them.
- [ ] **D5 — Bounded scheduling:** implement persisted budget/deadline and injected clock/jitter leaves. Test transient versus permanent classes, five-attempt exhaustion, genuine reconnect reset, notification storms, manual Retry of the same intake, shutdown timer cleanup, backward/forward clock changes and rate-limit bounds. Never let scheduling bypass reconciliation.
- [ ] **D6 — Library projection:** combine immutable document rows and intake/outcome evidence, preserve legacy document navigation, render literal URL/Open original/Retry and machine-owned status/severity. Obtain required copy approval first. Test durable failure → same-item success, short URL destination changes, duplicate existing document, concurrent outcomes, rejected observation and no fake reader/empty snapshot. No component owns an asynchronous workflow.
- [ ] **D7 — Actual browser qualification:** run `pnpm verify`, `pnpm test:e2e`, then `pnpm test:offline` sequentially. Component edits additionally require `pnpm format` and `pnpm format:check`. Record exact commits and evidence; no isolated-store result substitutes for these application checks.

The browser batch must include complete process termination while resolving/extracting, cold offline reopening with both servers stopped and HTTP cache cleared, retained link/failure state without a false article confirmation, real reconnect resumption with bounded attempts, completion into the same item, and separately restored-profile observation of the synced failure/completion graph. Fixture gateway responses are acceptable for deterministic interruption points when labeled; Jazz identity/authority, persistence, multi-tab coordination and browser process boundaries must be real. Include a real gateway extraction regression separately.

Instrument publication boundaries in test-only fixtures to terminate after the durable barrier, intent commit, document local settlement and before completion evidence. On restart assert publication invocation counts and exact document/snapshot identity, not only visible text. Exercise two tabs, crash the owning process, and prove takeover does not replay an uncertain publication. Scope replacement must leave no old-account URL/candidate visible.

Batch exit requires durable URLs and honest link-only outcomes across the qualified restart, retry of the same logical item, unchanged readable snapshots and zero replay of unknown publication. Update `tasks.md` and `implementation-handoff.md` with actual results only after those checks. Images, extensions/mobile qualification and full MVP completion remain open.

## Historical schema foundation validation

On the main-based foundation branch, `pnpm verify` passes 218 unit tests across 26 files, vendor verification, formatting, lint, strict app/service-worker checks and the production build. `pnpm test:e2e` passes all eight current-main Chromium regressions; `pnpm test:offline` passes all five production offline regressions. These commands ran sequentially. The five new schema tests use the real Jazz test authority; browser suites exercise existing capture/storage behavior, which does not consume the new tables. Counts differ from PR #11 because its reader changes are not included in this independent branch. No new hosted, capture-journal restart or target-device evidence follows from these checks.

## Admission capability validation

After incorporating merged reader PR #11, final `pnpm verify` passes 263 unit tests across 29 files and all vendor, format, lint, strict app/service-worker checks and production build checks. The final browser suite passes 15 Chromium tests; five production offline regressions pass afterward. Commands ran sequentially; `pnpm format:check` and `git diff --check` also pass.

Seven real-authority evidence tests now include the bounded native adapters and rejection of domain-invalid owner-written rows. Admission actor tests cover local/global separation, journal failures, native acquisition/commit/local-wait shutdown, checkpoint drain, lost scope, conflicting IDs, competing barriers, late rejection, final-checkpoint uncertainty and terminal buffer cleanup. Readable documents stay unchanged.

Three browser cases invoke the actual capability through `tests/intake-driver.ts`, using the real DLF identity/native Jazz and IndexedDB implementations. One stops the authority, admits a URL, persists a separate issuance barrier, closes the complete Chromium process, reopens the profile and checks exact submitted fragments/query order. The admitted checkpoint/native intake survive; the unresolved barrier stays uncertain without a native row. Reconnection then synchronizes the intake to an independently restored profile, which has no device-local execution checkpoint. Two further cases prove one native checkpoint claim winner, account-key separation, stale compare-and-set denial, bounded cursor pages and preservation of unsupported records.

The test driver does not fetch or extract articles. These results qualify the admission capability, not Add Link queue wiring, autonomous reconnect retries, publication barriers or link-only rendering. The production offline suite qualifies existing reader/shell regressions; it is not evidence for the journal in a production offline build. No new hosted or non-Chromium support claim follows.
