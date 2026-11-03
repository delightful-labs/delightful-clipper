# Session/private-root implementation design

This batch adds only account creation/restoration/recovery and the immutable private library root. DLF owns reusable session acquisition, startup attachment, readiness/retry and restoration workflows. Clipper supplies explicit create/logout intent, the root data capability and application coordination. DUI supplies form/status controls; i18next supplies English strings.

## DLF package and ownership

The vendor archive is built from DLF main `0582a9a5d7bc2cd56f52172ec5c1ca9213674056` (merged PR #10), using its committed lockfile and `pnpm package`/`pnpm pack`. `vendor/manifest.json` records the archive digest. No DLF source or pending sibling-worktree changes are copied into Clipper.

One public `createJazzStartupRegistry()` per browser application lifetime owns acquisition across layout attachments. Clipper invokes `createSessionStartupMachine()` to attach, retries acquisition through that child, and obtains the SDK session only from its scoped report. It invokes `createSessionReadinessMachine()` with the public Jazz readiness adapter for observation, subscription cleanup, reobservation and SDK retry. No second SDK session/promise cache, acquisition actor or callback observer is implemented in Clipper.

Detachment drains Clipper identity/root work and DLF readiness retry, releases the startup attachment, and invalidates attachment-local recovery/restoration adapters. It does not close the registry-owned SDK session. Late acquisition remains owned and can be reused by the next attachment. Changed service configuration requires coordinated cleanup; the DLF registry rejects silent environment replacement. Final SDK disposal is not provided by the DLF acquisition registry and is not inferred from attachment release.

The app coordinator is `createApplicationReadinessMachine` in `machines/runtime/application-readiness.ts`, matching Finance’s naming. It retains creating/restoring/logout invocations until settlement; observations during those operations update facts without abandoning issued identity work. DLF restoration is a child statechart with parse/prepare/mutate/read stages; only signed-out state accepts a phrase. The coordinator clears its phrase after validation; DLF clears transient credentials. No actor inspection, diagnostics or persistence receives credentials. Recovery phrase presentation uses DLF's Svelte composition.

## Clipper-owned root and scope boundaries

For a ready account/client binding, Clipper reads the canonical root locally, rejects incompatible records, issues only the identical immutable root ensure, waits for local persistence, then observes global acceptance separately. Only locally confirmed state is usable. Identity loss/replacement removes old library/recovery views; stale completions cannot enter a replacement binding. Interrupted immutable-root ensures are repeatable; general data writes are not introduced. Policies enforce authenticated owner and canonical row IDs, with no ordinary root deletion.

DLF's newer `recovery/coordination` includes route navigation and workspace drain. This signed-out-only restoration flow has neither an active workspace to drain nor a destination route to navigate; it composes the existing lower-level DLF restoration workflow directly.

DLF `workspace/initialization` requires profile/organization provenance and explicit authority discovery; its creation workflows require membership/transaction bundles. Those are not Clipper's approved single-row account-keyed root contract. Adding profiles, organizations or memberships solely to use those APIs would change the product model. The deterministic root schema, read/compatibility check, idempotent ensure and separate local/global settlement remain app-owned. Reassess reuse if DLF adds a compatible generic root workflow.

Failure states distinguish acquisition failure, session/observer unavailability, invalid restoration, identity mutation failure, root conflict, local persistence failure and sync rejection/pending. DLF owns acquisition retry and readiness retry/reobservation; Clipper retries only its compatible immutable root data operation. No captured content or note writes exist yet.

## Validation and remaining limits

Integration coverage uses real DLF actors for release/remount with late acquisition, acquisition retry, pending SDK retry drain, observation subscription failure/reobservation, pending local root writes, stale account bindings and invalid restoration. Native authorization tests exercise concurrent same-account ensure and alternate/foreign root rejection. Chromium tests use a disposable real authority for account creation, reload, independent-profile restoration, authority shutdown/restart and invalid restoration. Recovery traces/screenshots are disabled.

The current Jazz/Vite build emits the same approximately 19.3 MB WASM binary at both the application asset URL and the SDK worker asset URL, plus a large application chunk. The explicit runtime URL prevents a missing root-relative WASM request. Asset deduplication and download optimization remain follow-up work. This batch does not deploy a Netlify/Jazz service, provide a service worker/offline app shell or qualify non-Chromium platforms.
