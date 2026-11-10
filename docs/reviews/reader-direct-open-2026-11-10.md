# Direct-reader startup investigation — 2026-11-10

Investigated production commit `168cd0b` on `https://clipper.delightfullabs.com`,
using the previously marked private test article and the existing real AT Protocol
session. The initial diagnosis used the deployed application unchanged. The user
subsequently approved the reader-owned waiting behavior; its implementation and
bounded qualification are recorded below. No dependency, schema or production
deployment change is part of this repair.

## Confirmed failure

In a separate browser with an empty local replica, loading the library and then
hard-navigating to the saved reader URL reaches the correct route with HTTP 200.
The reader reports unavailable even though the article is stored remotely and
opens through ordinary library navigation.

Structural instrumentation in the application worker established this sequence:

1. The document header read succeeds in approximately 18 ms. The original
   account/library capability remains current.
2. Required snapshot and optional asset reads return no row in approximately
   6 ms, while Jazz's public sync status reports `link.state: 'connecting'`.
   The configured `firstLoadRemoteWaitMs: 5_000` is present in the deployed
   capability; it did not hold these reads until a server answer in this run.
3. A diagnostic server-confirmed snapshot query returns the existing text roughly
   400 ms later, with Jazz reporting connected. The reader remains unavailable.

The diagnostic reported only timings, existence/type checks and public connection
status. It did not export user content, identifiers, credentials or browser state.
The extra server query was diagnostic only, not a proposed product read strategy.

## Ownership gap in Clipper

`apps/web/src/lib/backend/jazz/records.ts` uses one-shot local-first reads for
the header, snapshot and asset. The snapshot and asset request an initial remote
wait, but a null result alone does not establish an authoritative absence.

In `apps/web/src/lib/machines/storage/read.ts`, completion of the required snapshot
with null takes `readRecordMachine` directly to final `unavailable`. That closes
the read owner before the connection finishes. There is no reader-owned wait for
connection readiness or later snapshot delivery.

`apps/web/src/lib/machines/capture/library.ts` can reopen an unavailable reader
when its article-list subscription emits suitable `ROWS`. Arrival of the saved
snapshot does not itself guarantee a new article-list event. Therefore that
recovery path does not repair this startup ordering.

The app-level cause is confirmed: temporary local absence during connection
startup becomes a terminal reader result. The reason Jazz's initial remote-wait
option returned immediately in this specific follower/runtime state remains
unresolved; this investigation does not establish an upstream SDK defect.

## Isolated hypothesis check

A second, empty-replica browser intercepted only its downloaded application-worker
response. It wrapped the existing read capability for this diagnostic:

- Run the original local-first snapshot/asset read.
- If absent while Jazz reports connecting, await the SDK's native
  `onSyncStatusChange` notification that the connection leaves connecting.
- Repeat the original local-first read.

The saved reader opened with no alert. The required snapshot and optional asset
were present after approximately 350 ms. This check used no forced remote query,
fixed sleep, changed timeout, dependency patch or deployed repair. The browser was
closed afterward. The wrapper is an experiment, not a qualified implementation:
it does not model production cancellation, prolonged connection attempts or all
offline outcomes.

## Approved implementation

`readRecordMachine` now invokes `createLocalReadMachine` for each document,
snapshot and asset read. Its explicit states are reading, waiting, rereading and
the found/absent outcomes. A cached row completes the first read without acquiring
a connection subscription. After a local miss, an owned callback actor reports
the current native connection state and later changes. Connecting remains pending;
connected selects one more local-first read; offline/local-only resolves absence.
The separate rereading state prevents an absent record from causing a retry loop.
Publishing the current state after listener registration also covers connection
completion between the initial query and observer admission.

The browser session supplies `readConnection(db)`, which uses the public
`getSyncStatus` and `onSyncStatusChange` APIs. Query-only/server producers omit that
optional capability and retain ordinary missing-record behavior; their facades
do not own the browser upstream lifecycle. This distinction is explicit at the
producer, rather than inferred from the runtime or from `isLocalFirst()`.

Exiting the waiting state releases the native subscription. Stopping the reader
also aborts an issued reread; late results remain subject to the existing account
scope and reader-generation checks. Required/optional integrity and error
handling are preserved. The main thread, stored data, localization catalog,
authentication and package patches are unchanged.

## Implementation qualification

The complete repository verification passes: 683 unit/native tests across 109
files, strict web/extension/service-worker types, lint, formatting, vendor
verification and the production build. New coverage includes partial replicas at
each read boundary, cached reads while offline/local-only/connecting, actual
absence, connection completion before observer admission, scope loss, shutdown,
native listener release, aborted rereads and optional/required failures. A seeded
`@xstate/test` campaign runs 100 cases with up to 20 commands against an independent
obligation model, including repeated native notifications and no reopening after
settlement.

The actual built worker was then supplied only to two isolated fresh browser
contexts using the existing same-app session and production backend. In each,
the previously failing library-to-hard-reader navigation rendered the marked saved
text and survived three reloads, with no unavailable alert or Window exception.
The experiment served the unmodified built artifact in place of the downloaded
worker and its matching assets; it did not insert a replacement read workflow or
alter the production deployment. The original browser profile was used only to
obtain the same-app session in memory, not as the replica under test. Production
still needs the normal PR deployment/merge verification.

All eight built-app offline cases pass, including two complete browser-process
restarts, durable offline edits, reconnect, linked/existing/expired-session
fixtures and genuinely cold authenticated reader URL loads. All six dedicated
worker browser cases pass, including shutdown during acquisition, native identity
reuse, stale scope refusal and no Window WASM initialization. All seven reader
browser cases pass, including reader reload, progress and presentation. Fixture cold-reader
coverage alone does not reproduce the original production timing; the controlled
actor regressions and isolated built-worker check supply the corresponding
behavioral evidence.
