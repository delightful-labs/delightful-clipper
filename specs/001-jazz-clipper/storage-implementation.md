# Bounded text/byte persistence foundation

This PR completes the next bounded portion of foundation work: real immutable document/snapshot and owner-scoped manifest/part persistence, local verification and explicit remote acceptance. It adds repository capabilities, not capture, manual-text-entry product UI, image processing, annotation or reader controls. Chromium qualification now exercises production repository machines through an isolated test module: new content saved with the authority stopped survives a full persistent-browser process restart and syncs to an independently restored account profile. The web shell remains served; this does not qualify an offline shell or other browsers.

## Ownership and reuse

DLF main remains `0582a9a`; its public `workspace/creation/workflow` transaction factory is generic over the transaction and persisted result. Reuse its acquisition, stage, commit, local-wait and rollback protocol. The local-wait leaf calls the native write handle directly to avoid importing the DLF Svelte SDK entry into headless repository tests. Its transient `workspaceId`/`membershipId` fields map to the intended document/manifest IDs; no organization, membership or workspace records are introduced. DLF's IndexedDB workspace journal requires organization-shaped attempts, so it is not adopted. Clipper journals immutable operation metadata in its own owner-scoped Jazz table.

A scoped repository binds one ready account/client generation. It provides save/read machine logic. The consuming capture/integration owner must invoke those children and drain them before identity changes; this PR does not expose a new write UI. Every SDK leaf checks the binding adjacent to use and after asynchronous reads. The read result checks account scope before returning available content; terminal read states clear intermediate content. Deterministic machine tests cover shutdown during acquisition, commit and local settlement, uncertain local settlement without replay, and account changes. Native authority rejection is observed through the sync machine. DLF acquisition and recovery remain unchanged.

## Storage and workflow

For this initial bounded path, text is at most 64 KiB UTF-8 and binary input at most 1 MiB. Prepare one immutable operation ID, timestamp and SHA-256 fingerprints, gzip the bounded bytes, and divide compressed data into at most 256 KiB parts. Codec/hash work is a bounded computational leaf, not a read/check/write workflow. This is not an unbounded upload or image-processing pipeline.

The save statechart owns prepare → intent transaction → parts transaction → read-back → verify → publish transaction. Each transaction uses DLF's resource owner and a mergeable Jazz transaction, because exclusive acceptance requires an online authority. Intent atomically stores operation metadata and an immutable manifest. Parts are locally durable and verified before document/snapshot publication. The immutable document is the publication marker; a manifest with no document remains staging, not complete or available.

Each record uses stable IDs within an attempt. Per-part IDs derive from operation ID and ordinal. No updates, generic upserts or automatic write replay are exposed. The operation row is an immutable journal of intended identity/fingerprint, not proof of completion. Failed/uncertain operations retain their ID and caller content; read/reconciliation may establish a complete matching document but missing local data never proves non-commit. Automatic continuation/replay after uncertain outcomes is outside this capability.

The save actor has independent control/work regions. Shutdown waits for acquired transaction/commit cleanup through DLF and does not start another stage. Returned local success requires all three transactions and read-back verification. Remote acceptance is a separate receipt/machine; rejection does not become a second save. Read states independently verify text and assets. Missing/corrupt byte parts preserve verified text with explicit asset unavailability; they never produce a false offline-complete result. Decompression enforces the original byte limit while reading output.

## Authorization and acceptance

Every row/part is tied to the canonical library and same-library parents at the authority. Immutable rows deny updates/deletes. Tests must exercise forged library/parent references, unrelated-account reads, atomic rejection, exact bytes/hashes, a payload spanning multiple parts, interrupted writes, uncertainty without replay, stale binding results and late remote rejection.

Pending browser acceptance must use the existing production session/root integration plus these production repository machines in an isolated test module. Save previously unuploaded text/bytes while the authority is stopped, close the browser process, reopen the same profile, and verify exact local text/bytes. Reconnect and verify the same immutable record in a separately restored account profile. The web shell remains served; the service worker/offline shell is subsequent work.

## Gateway identity boundary

The trusted request leaf copies only the current managed Jazz bearer immediately before a fixed same-origin capture request and rejects responses after an account/client change. The server hook protects `/api/capture` and its descendants using the public Jazz verifier and required canonical `JAZZ_ACCOUNT_REGISTRY`; verified account IDs are supplied in server locals. Missing/forged credentials return 401; configuration/registry failures return 503. Responses are private/no-store. Chromium verifies real managed-bearer registry admission (reaching 404 routing because capture endpoints remain unbuilt) and 401 rejection. No capture transport or deployed Linux native qualification is claimed.

Validation: `pnpm verify` passes (37 unit tests, formatting, lint, type checking, vendor verification and production build). All five Chromium acceptance tests pass, including offline content restart/convergence and gateway authentication.
