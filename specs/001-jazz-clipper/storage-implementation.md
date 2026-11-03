# Bounded text/byte persistence foundation

This PR completes the next bounded portion of foundation work: real immutable document/snapshot and owner-scoped native Jazz text/byte persistence, bounded domain validation and explicit remote acceptance. It adds repository capabilities, not capture, manual-text-entry product UI, image processing, annotation or reader controls. Chromium qualification now exercises production repository machines through an isolated test module: new content saved with the authority stopped survives a full persistent-browser process restart and syncs to an independently restored account profile. The web shell remains served; this does not qualify an offline shell or other browsers.

## Ownership and reuse

DLF main remains `0582a9a`; its public `workspace/creation/workflow` transaction factory is generic over the transaction and persisted result. Reuse its acquisition, stage, commit, local-wait and rollback protocol. The local-wait leaf calls the native write handle directly to avoid importing the DLF Svelte SDK entry into headless repository tests. Its transient `workspaceId`/`membershipId` fields map to the intended document/asset IDs; no organization, membership or workspace records are introduced. DLF's IndexedDB workspace journal requires organization-shaped attempts, so it is not adopted. Clipper journals immutable operation metadata in its own owner-scoped Jazz table.

A scoped repository binds one ready account/client generation. It provides save/read machine logic. The consuming capture/integration owner must invoke those children and drain them before identity changes; this PR does not expose a new write UI. Every SDK leaf checks the binding adjacent to use and after asynchronous reads. The read result checks account scope before returning available content; terminal read states clear intermediate content. Deterministic machine tests cover shutdown during acquisition, commit and local settlement, uncertain local settlement without replay, and account changes. Native authority rejection is observed through the sync machine. DLF acquisition and recovery remain unchanged.

## Storage and workflow

For this initial bounded path, text is at most 64 KiB UTF-8 and binary input at most 1 MiB. Clipper validates its domain input and prepares an immutable operation ID, timestamp and payload fingerprint for journal reconciliation. Jazz stores text and bytes directly in native columns; Clipper does not gzip, split, reassemble or checksum storage parts. The bounded preparation leaf is in `storage/prepare.ts`; the previous codec is removed.

The save statechart owns prepare → intent transaction → publication transaction. Both use DLF's resource owner and a mergeable Jazz transaction, because exclusive acceptance requires an online authority. Intent stores the immutable operation journal. Publication atomically inserts the native byte asset, text snapshot and document. Jazz's local write receipt establishes local persistence of the entire transaction. A journal or asset with no published document remains staging, not available content.

Each record uses stable IDs within an attempt. Per-part IDs derive from operation ID and ordinal. No updates, generic upserts or automatic write replay are exposed. The operation row is an immutable journal of intended identity/fingerprint, not proof of completion. Failed/uncertain operations retain their ID and caller content; read/reconciliation may establish a complete matching document but missing local data never proves non-commit. Automatic continuation/replay after uncertain outcomes is outside this capability.

The save actor has independent control/work regions. Shutdown waits for acquired transaction/commit cleanup through DLF and does not start another stage. Returned local success requires both transaction local receipts. Remote acceptance is a separate receipt/machine; rejection does not become a second save. Reads validate supported snapshot format, bounds and parent/library relationships. Missing or invalid assets preserve readable text with explicit asset unavailability. Every terminal read state clears intermediate content. Jazz owns persistence, transfer and storage integrity; Clipper retains no second storage protocol or read-back checksum workflow.

## Authorization and acceptance

Every row is tied to the canonical library and same-library parents at the authority. Immutable rows deny updates/deletes. Tests must exercise forged library/parent references, unrelated-account reads, atomic rejection, exact native bytes (including a 600 KiB payload), interrupted writes, uncertainty without replay, stale binding results and late remote rejection.

Pending browser acceptance must use the existing production session/root integration plus these production repository machines in an isolated test module. Save previously unuploaded text/bytes while the authority is stopped, close the browser process, reopen the same profile, and verify exact local text/bytes. Reconnect and verify the same immutable record in a separately restored account profile. The web shell remains served; the service worker/offline shell is subsequent work.

## Gateway identity boundary

The trusted request leaf copies only the current managed Jazz bearer immediately before a fixed same-origin capture request and rejects responses after an account/client change. The server hook protects `/api/capture` and its descendants using the public Jazz verifier and required canonical `JAZZ_ACCOUNT_REGISTRY`; verified account IDs are supplied in server locals. Missing/forged credentials return 401; configuration/registry failures return 503. Responses are private/no-store. Chromium verifies real managed-bearer registry admission (reaching 404 routing because capture endpoints remain unbuilt) and 401 rejection. No capture transport or deployed Linux native qualification is claimed.

Validation: `pnpm verify` passes (40 unit tests, formatting, lint, type checking, vendor verification and production build). All five Chromium acceptance tests pass, including offline content restart/convergence and gateway authentication.

## Simplification on PR #5

The user approved replacing the custom codec with native Jazz storage. `BlobManifest`/`BlobPart`, gzip, part IDs, per-part hashes, text storage checksums, reassembly and the extra parts/read-back save phases are removed. Domain fingerprints remain only in the operation journal. This changes the unreleased foundation schema; existing synthetic fixtures/preview apps using the old tables are not migrated. New disposable authorities exercise the actual simplified schema and policies. Chromium verifies a 600 KiB native payload by full length/digest after offline process restart and after same-account restoration/sync; hashing here is test evidence, not another production integrity layer.
