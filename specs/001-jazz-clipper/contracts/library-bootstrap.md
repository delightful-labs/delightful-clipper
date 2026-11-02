# Private library bootstrap — selected Clipper integration

**Status**: Design selected after isolated qualification. Ready for first implementation batch; production integration and independent offline-replica proof remain unbuilt. Supersedes this file's earlier assumption that generic DLF workspace creation must be completed first.

## Ownership and scope

DLF's packaged public session/readiness/recovery/restoration adapters are available and were exercised in an isolated browser and extension fixture. DLF remains the identity/recovery owner. Clipper owns its concrete library schema/policies and data operations; DUI owns generic presentation. Clipper needs one private personal library, no workspace chooser, names, invitations or collaboration UI.

Generic DLF workspace creation remains separately designed foundation work. It is not necessary merely to ensure Clipper's own immutable domain root. See [investigation results](../investigation-results.md) for exact evidence and [implementation handoff](../implementation-handoff.md) for the first batch.

## Canonical root contract

- Within Clipper's app/table namespace, library row ID equals the authenticated account UUID. No random fallback root ID and no empty-directory-based identity creation.
- Root payload contains immutable `ownerId` and bootstrap format `1`. Mutable preferences, names, capture records and schema migrations are outside this payload.
- Reads require authenticated ownership. Insert/update policy requires both row ID and owner ID to match the authenticated account and the supported immutable format. Ordinary root deletion is not exposed.
- Idempotent ensure writes only the exact immutable payload. A recovered account addresses the same root; two clients do not allocate different roots. Conflicting existing values fail as integrity/compatibility errors, not overwrites.
- Ensure does not imply local durability. Await local persistence before using its Saved evidence; track remote acceptance/rejection separately. Missing/unsupported query scope is not confirmed absence.
- Only this identical immutable ensure can safely repeat without resolving a historical transaction's fate first. Captures, notes, tags and deletion retain their independent operation IDs, journals and reconciliation. No blind general upsert retry policy.

## Scope replacement and recovery

Bind the operation to the DLF account/client generation. Account replacement invalidates old views immediately but issued resources remain owned until settled/drained. Initial identity creation and recovery remain DLF operations; ensuring a library must not silently create or replace an identity.

Journal domain operations before external intake can be lost, using stable intended record IDs. Unknown commit outcomes remain explicit and are reconciled before non-idempotent retry. An incomplete offline replica's missing record cannot establish failure-before-commit. Closing a dialog or stopping an actor is not rollback evidence.

## Permission invariants

Every durable domain row and byte part has an enforced same-owner/library path. Inserts and updates check references at the storage boundary; UI filters and knowledge of IDs grant no authority. No public grants, cross-owner asset deduplication or roles. Local availability is not fresh remote authorization; revocation does not erase already disclosed copies.

The first authority proof exercised owner-only reads/bytes, forged-owner/foreign-parent rejection and atomic failure. The later canonical-root proof exercised concurrent same-account contexts, identical replay, alternate root-ID denial and foreign denial. Read policy stays owner-only; write-specific canonical predicates need not be duplicated into every read query (the overly constrained experimental shape hit SDK coverage limits).

## Remaining G1 acceptance

Use the exact pinned DLF package; implement the actual Clipper root/domain schema and policy graph. Prove canonical ensure on two independent offline replicas, local restart, restored-account access, late rejection and interruption recovery. Browser/extension fixture page-reopen results are supporting evidence, not full PWA/process-restart acceptance. Generic foundation workspace creation is no longer a prerequisite for this Clipper root.
