# XState memory: explicit workflow ownership

This is a standing user instruction for every agent working in this repository. Read it before designing, changing or reviewing asynchronous workflows, persistence operations, actor lifetimes or notification handlers. The user has repeatedly required these boundaries; do not wait for another reminder or treat them as optional cleanup.

## Model the workflow before writing the implementation

The chart must show what happens next and why. States, events and named guards own admission, operation selection, sequencing, success, refusal, failure, retry, cancellation and shutdown. Actions and invoked actors implement the operation that the chart selected.

Do not put an imperative workflow inside an invoked promise, action, repository method or callback and call it state-driven because a machine invokes the function. Extracting an `if` block into a named helper only improves naming; it does not transfer ownership to the chart. If a branch selects different writes or different subsequent operations, represent those alternatives as guarded transitions and states.

Before implementation, identify:

- The operation's owner, input, identity and lifetime.
- The facts needed for each decision and the actor that reads them.
- The guards and states that select each operation.
- The resource owner and completion acknowledgment for every issued effect.
- What cancellation, account changes, partial failure and unknown outcomes mean.

## Keep implementations reusable and charts readable

Register descriptive guards, actions and actor sources in `setup`; reference their names in the chart. Use action/guard parameters and small context/event adapters to reuse implementations without coupling every function to the entire machine context.

Guards must be pure, synchronous predicates. Give domain rules names such as `canBindIntent`, `hasArticleParent`, `sourceUnchanged` and `matchingCapture`. Compose shallow named predicates with `and`, `or` and `not` when useful. Do not bury parsing, scope checks, history construction and sequence comparison together inside an anonymous guard.

Ordinary functions remain appropriate for schema validation, protocol decoding, serialization, pure projection and bounded I/O. A coherent transaction-local snapshot read or an already-selected atomic batch can be one I/O operation. Do not create a state for every primitive calculation or database call. The distinction is whether the function implements a selected operation or decides the workflow itself.

Do not add transient states solely to check facts and route immediately. Put guarded alternatives on the preceding completion or eventless transition when that expresses the same decision clearly. Keep states that own work, waiting or a meaningful lifecycle boundary. Retain a decision boundary when its guards must observe state changes made by the same event in parallel regions; transition guards run before those sibling transitions apply.

For a synchronous effect followed immediately by completion, put the named action on the selected transition into a shared final state. Use ordered action arrays for an already-selected synchronous sequence; a thrown action must prevent subsequent actions and successful completion. Do not add action-only states solely to transition immediately to `done`. Keep distinct states for asynchronous work, resource ownership, waiting and meaningful outcomes. Child machines still need final states to deliver output through the parent's `invoke.onDone`; staging completion does not imply commit, local durability or remote acceptance.

Keep detailed implementations outside deeply nested state configuration. A readable chart should expose names and transitions, rather than hide blocks of application code inside `invoke.input`, `onDone.actions`, entry actions or guard callbacks.

## Make data flow explicit

Return decoded facts from read actors. When those facts determine the next state, evaluate named guards against completion output in `onDone`, retain facts with a returned `context` patch on the selected transition, and pass the selected inputs to the next actor/action. Completion guards run before transition actions, so they must not depend on context assigned by that same transition. Mutations must use the facts and payload that were actually validated for that operation.

Never mutate machine context directly. Do not pass domain facts between stages through mutable side channels on a transaction resource, closure or shared object. Fields such as `resource.article`, `resource.parents`, `resource.hash` and `resource.imported` hide workflow state and are prohibited. Native transaction and receipt handles are imperative resources; their existence does not justify attaching application decisions or observations to them.

Keep control state in states. Do not reconstruct progress from combinations of `started`, `saving`, `cancelled`, `mode` or similar workflow flags. A request discriminator can select a guarded path; it must not drive conditional side effects hidden inside one action.

## Give actors and effects an owner

Use invoked actors for work whose completion or failure affects the workflow. Actions are fire-and-forget; an `async` action is not awaited by XState. Use named calculation functions for immutable context patches, enqueue native synchronous effects with `enq`, and invoked actors for asynchronous work that the machine must await.

Invoke or explicitly spawn child workflows from their owning machine. Do not manually call `createActor`/`toPromise` from inside a staging callback or I/O leaf to hide a nested workflow. Starting a root actor at a real boundary is appropriate: UI mount, HTTP request, worker realm, browser message or public promise API. That boundary must attach result/error handling and own shutdown or cleanup.

Callback actors translate native events into machine events and execute selected commands. They do not choose application outcomes in callback-local promise chains. Keep protocol decoding, native handle manipulation and resource release in the adapter; put domain decisions in named chart guards and transitions.

Stopping a promise actor does not undo an issued effect. Use cooperative cancellation where supported, drain issued writes before releasing their owner, and preserve uncertain results. Do not replace a draining adapter with a plain invocation unless equivalent cleanup and settlement behavior is qualified.

## Preserve transaction and account boundaries

Use one transaction owner for acquisition, transaction-local reads, mutation staging, commit, local durability and rollback. Keep eligibility reads and the selected writes in that same transaction. Do not open a second transaction merely to make a branch easier to model.

In Clipper, DLF retains transaction lifetime and settlement ownership; domain charts own domain eligibility and mutation paths. Use the shared [transaction bridge](../../apps/web/src/lib/machines/storage/domain-transaction.ts) and [domain model](../../apps/web/src/lib/machines/storage/domain-model.ts) when its callback API needs to compose with a domain chart. Internal read/stage messages must stay behind the public lifecycle interface. Do not copy the DLF transaction workflow for each operation or add domain facts to its resource as a workaround.

Enforce scope at actor admission, result consumption and transaction admission/commit boundaries. Keep I/O bound to its original DB/library. Do not scatter pre/post `isCurrent` checks throughout repository leaves or let stale results retarget another account's resources.

Local persistence and remote acceptance are separate outcomes. Report local durability only after its actual acknowledgment; report synchronization only after the native remote receipt succeeds. Preserve stable operation identity and exact intent for unknown-write reconciliation. Never blindly replay an uncertain write.

For IndexedDB, keep compare-and-move/delete checks and mutations in one active native transaction. Emit request results to the owning chart and issue subsequent commands synchronously before the native callback returns; arbitrary awaited work can let the transaction auto-commit. Acknowledge writes from transaction completion, not request success. The [draft mutation chart](../../apps/web/src/lib/notes/draft-mutation-machine.ts) demonstrates atomic recovery and exact-acknowledgment removal.

For notifications, show admission, optional lookup, validation, display and acknowledgment explicitly. Reject untrusted inputs before private reads or display effects. Acknowledge only after the display operation completes. See the [extension notification chart](../../apps/extension/src/notification-machine.ts).

## Review and qualify the actual workflow

Review the owning chart and its adapters together. Ask:

- Can a reader see which guard permits each mutation and what runs next?
- Does each asynchronous completion return facts through an explicit output/event?
- Are there domain fields on native resources, hidden nested actors, mode-dependent writes or promise chains that choose the next operation?
- Is every effect owned through completion, failure, cancellation and account changes?
- Are local, remote and unknown settlements represented honestly?
- Are remaining conditionals ordinary validation/projection, rather than concealed workflow selection?

Test meaningful branch selection and mutation order, rejection before side effects, failure before later writes, cancellation during acquisition/read/staging/commit, shutdown draining, scope changes, rollback failure and unknown outcomes without replay. For notifications, test sender admission, exact capture matching, display failures and completion before acknowledgment. Exercise the actual native policies, migrations, IndexedDB adapter and packaged extension where relevant; passing types or tests of extracted helpers alone is insufficient. Avoid tests that merely mirror implementation text.

## Official guidance

- [Guards](https://stately.ai/docs/guards): pure synchronous predicates, named guards and guarded transition alternatives.
- [Actions](https://stately.ai/docs/actions): named implementations, parameters and fire-and-forget effects.
- [Invoking actors](https://stately.ai/docs/invoke): completion/error handling and parent-controlled actor lifetimes.
- [Context](https://stately.ai/docs/context): immutable context updates (v6 uses returned context patches).
- [Promise actors](https://stately.ai/docs/promise-actors): cancellation signals and the limits of stopping promise work.

These sources explain XState's mechanisms. The requirements above also record the user's stricter application architecture preferences; do not misrepresent every preference as an XState library restriction.

## Installed v6 contracts

The web, extension and workers use published `xstate@6.0.0-beta.1`. Read the
installed `xstate/docs` mechanism guides and `xstate/agents.md` when changing a
chart. `setup({ schemas })` declares context, inputs, event payload maps, outputs
and children. Selection and `.can()` may evaluate calculation functions: return
context patches, use `enq` for effects, and obtain native observations through
owned logic. Only self-originated coordination belongs in `internalEvents`;
callback, worker and subscribed-child reports belong in `events`.

Use `type: 'choice'` with a total, effect-free `choice` for pure routing. Keep
conditional waits, context-producing steps and effect-producing transitions as
`always`. Consume `event.output` from completion; completed children need not
remain in `children`. Relative state predicates include the full root nesting,
including `active.flow`, and cancellation joins must observe the correct region.

Generic native capability contracts accept the typed `ChildSpawner` capability
and return an owned `ActorInstance` with its actual command protocol. This avoids
pretending that a child with additional internal events has a narrower generic
`ActorLogic` protocol. Keep the concrete source at its producer and explicitly
stop retained refs on their owner’s exit. Preserve `.provide()` source injection.

A queued mutation is acknowledged with `STAGED` before producing a receipt;
terminal output calculation must not assume an entry effect has already run.
Native commit/receipt handles remain in adapter closures, while domain facts
remain immutable chart context. See the migration specification for exact shared
artifact provenance and qualification results.

Use `@xstate/test@2.0.0-beta.0` for generated campaigns against independent
contracts and real actor SUTs. Keep explicit generators, bounds, seeds and
coverage requirements, retain shrinking/replay artifacts through the built-in
failure store, and preserve native browser/Jazz tests.
