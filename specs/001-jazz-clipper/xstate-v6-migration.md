# XState v6 migration and worker ownership specification

Status: proposed specification for review, 2026-11-09. No runtime conversion in
this PR. Source baseline: main `78d611f8bcf8e7a05d61408515545a711c7598bd`.
Active feature and accepted product scope remain unchanged.

## Goal and versions

Adopt the v6 authoring/ownership model across the web app, extension, service
worker and application worker while preserving local-first startup, capture,
reader, account, transaction and shutdown behavior. A codemod is migration
assistance; a type check is not behavioral equivalence.

Use published, unpatched `xstate@6.0.0-beta.1` as the coordinated candidate and
`@xstate/codemod@0.1.0-beta.1` as migration tooling. Recheck selected releases at
implementation start and record any delta. Read the installed package's
`docs/index.md`, `agents.md`, `api-stability.json` and relevant mechanism guides.
Do not add XState patches, declaration overrides or untyped actor escapes.

Current web/extension pins are v5.33.2. Main already has the application worker
and configured Jazz alpha.60 patches. Reuse that implementation, not an older
article-extraction worker or an unmerged historical checkout. The current
`pnpm-workspace.yaml`, `patches/jazz-tools@2.0.0-alpha.60.patch`, shared archives
and DLF patch define the actual consumer boundary. Changing Jazz is separate
from converting XState. Rebuild compatible shared artifacts before their adoption.

## Ownership and migration units

| Unit / source | Owner and behavior to preserve |
| --- | --- |
| `runtime/worker/host-machine.ts`, `application.worker.ts` | Worker realm owns the application graph. Account replacement invalidates scopes; domain drain, pending acquisition, SDK close and detached custody govern clean termination. |
| `runtime/worker/account-store.ts`, `storage-channel.ts`, `broker-channel.ts` | Account update holds the existing shared Web Lock across read/transform/write/release. Window brokers only required native storage/SharedWorker operations. Reuse identity/storage namespace across realms and tabs. |
| `machines/runtime/application-readiness.ts`, recovery owner | DLF owns shared identity/recovery contracts; browser navigation remains host-supplied. Completed children disappear from `children` after their lifecycle event. Preserve result/error facts before then. |
| `machines/storage/domain-transaction.ts`, `domain-model.ts`, save/organize/read | DLF retains native transaction lifetime/settlement. Domain guards select reads/staging within that owner. Keep explicit partial, cancelled and unknown settlement; no procedural promise rewrite. |
| Capture, reader, image, tag and note charts | Worker domain state and UI interaction capabilities remain separate. Release ImageBitmap/ports/object URLs/listeners in their owning realm. Keep native IDB commands synchronous where transaction liveness requires it. |
| Extension launch/sign-in/authorization/capture/notification charts | Preserve trusted sender admission, explicit account confirmation, popup lifetime, original user gesture, display acknowledgment and drain of issued writes. |
| Offline registration/cache/asset and diagnostics | Service-worker lifecycle differs from dedicated-worker lifecycle. Preserve offline shell/runtime assets and upgrade v5 inspection consumers. |

All paths above are under `apps/web/src/lib` unless explicitly extension-owned
under `apps/extension/src`. The public native promise boundary in account-store
is an SDK adapter; a new domain workflow must not create nested roots inside a leaf.

## Documentation-led design requirements

1. **Pure calculation:** all effects use `enq` or owned actor logic. Audit called
   helpers, closures and context resources for mutation during selection/`can`,
   not just obvious assignments. Copy plain data at integration boundaries when
   freezing it would affect an SDK/caller-owned object.
2. **Readable branches:** use total, effect-free choice nodes for routing. Keep
   conditional waits and context/effect-producing steps as `always`. Keep target
   literals visible; runtime graph analysis of functions remains incomplete.
3. **State contracts:** use typestates for proven resource/readiness facts and
   evaluate state input for operation-local data. Do not drop receipts or exact
   intent when exiting a state whose writes still need draining/reconciliation.
4. **Event origins:** inventory UI commands, native/child reports and self-raised
   coordination separately. Only self-originated events belong in internal
   schemas. Worker `postMessage`, callback `sendBack` and SDK reports cross actor
   boundaries and must remain deliverable through their public protocol.
5. **Typed lifetimes:** prefer state-owned invokes; use spawned refs only with
   explicit longer ownership. Type children and stable IDs where the beta can
   express the real contract. Consume outputs/errors from lifecycle events.
6. **Final semantics:** final states permit entry/exit and output; unsupported
   final transitions/invokes/timers move to non-final owners. Do not relocate all
   terminal cleanup before source exits. Queued effects are not awaited; model
   any acknowledgment that governs success or subsequent work as an invocation.
7. **Parallel semantics:** review storage save/read/organize, library/runtime and
   offline-region exit sets. Region-local reentry no longer resets siblings.
   Record cancellation precedence and full-state join conditions per chart; do
   not infer sibling updates from the same event before they apply.
8. **Errors/timeouts:** retain cooperative signals and native command/drain
   adapters. Actor stop is not rollback, and a missing send target is a dead
   letter, not an errored sender. Supervise roots and observe dead letters
   separately from `@xstate.actor`/`@xstate.transition` inspection.

Mechanism references: [agent guide](https://stately.ai/docs/xstate/v6/agents),
[execution](https://stately.ai/docs/xstate/v6/how-xstate-runs-machines),
[choice states](https://stately.ai/docs/xstate/v6/choice-states),
[typestates](https://stately.ai/docs/xstate/v6/typestates),
[internal events](https://stately.ai/docs/xstate/v6/internal-events),
[invokes](https://stately.ai/docs/xstate/v6/invoke),
[final states](https://stately.ai/docs/xstate/v6/final-states),
[parallel states](https://stately.ai/docs/xstate/v6/parallel-states).
The repository memory's architectural requirements remain binding; v5-specific
syntax examples are reconciled when each connected unit converts.

## Concrete purity finding

`runtime/worker/host-machine.ts` currently generates `crypto.randomUUID()` in
the `bindLibrary` assignment. v6 transition selection may evaluate that function
without accepting it. Move scope issuance to an explicit host admission/leaf
boundary and carry the issued identity into the binding event; do not mint a new
scope while calculating a candidate transition. Preserve exact correlation and
rebind behavior with the worker protocol.

## Worker protocol and persistence

Retain bounded Zod-decoded DTOs, transfer lists and port lifetimes. Validate both
command and projected-result boundaries: a v6 type schema does not automatically
validate `actor.send`. Check current scope/request identity when admitting a
message and consuming its result. Receipt of a message is not a persistence ack.
Do not transmit live actor refs, Jazz sessions, DB handles or raw snapshots.
Redact secrets and private payloads before diagnostics leave their realm.

Keep the existing explicit Window/worker protocol. XState address-only snapshots,
registries and experimental durable/system APIs do not automatically provide a
Web Worker runtime, shared browser storage, authorization or stale-result safety.
Do not introduce those facilities without a separate requirement. Inventory
actual restored XState snapshots before adding migration/versioning; application
records, Jazz storage and transaction journals are separate durable formats.

## Implementation and qualification sequence

- Capture exact v5 source, public inputs/event cases, outputs and failure/drain
  traces before transforming each connected unit. Record codemod manual sites
  and baseline-runtime versions. No unexplained diff is accepted by changing a baseline.
- Start with a leaf and a typed composition, then convert connected domain/runtime
  units with compatible DLF/DUI artifacts. Web, worker, extension and offline
  builds must use the intended versions; do not exchange v5/v6 live actor refs.
- Review charts and native adapters together against the requirements above.
  Preserve parent state/source injection and exact settlement policy.
- Qualify rejected/duplicate/stale messages, A → B → A rebinding, sibling reentry,
  same-event cancellation, delayed acquisition, rollback/commit uncertainty,
  failed drain and worker failure. Never acknowledge safe termination merely
  because an actor stopped.
- Run relevant type/lint/package/consumer, web-worker/service-worker, extension
  and browser checks. Native coverage includes identity reuse, offline restart,
  multi-tab account updates, broker/storage disconnect, request/result bounds,
  lock release and drain before termination. Record engines, SDK/patch versions
  and skipped cases. Reuse scoped tests; do not rerun unrelated suites repeatedly.

Existing native coverage provides test intent, not a fresh v6 qualification.
Finance may reuse the broker/storage mechanisms only after exact-version
qualification; Clipper domain protocols remain Clipper-owned. The coordinated
scope is DUI, DLF, Clipper and Finance; local-first-ux-patterns is excluded.
