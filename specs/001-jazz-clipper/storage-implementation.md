# Bounded text/byte persistence foundation

This PR completes the next bounded portion of foundation work: real immutable document/snapshot and owner-scoped manifest/part persistence, local verification and explicit remote acceptance. It adds repository capabilities, not capture, manual-text-entry product UI, image processing, annotation or reader controls. Storage browser qualification is still pending; the existing browser suite covers session/private-root behavior only.

## Ownership and reuse

DLF main remains `0582a9a`; its public `workspace/creation/workflow` transaction factory is generic over the transaction and persisted result. Reuse its acquisition, stage, commit, local-wait and rollback protocol. The local-wait leaf calls the native write handle directly to avoid importing the DLF Svelte SDK entry into headless repository tests. Its transient `workspaceId`/`membershipId` fields map to the intended document/manifest IDs; no organization, membership or workspace records are introduced. DLF's IndexedDB workspace journal requires organization-shaped attempts, so it is not adopted. Clipper journals immutable operation metadata in its own owner-scoped Jazz table.

A scoped repository binds one ready account/client generation. It provides save/read machine logic. The consuming capture/integration owner must invoke those children and drain them before identity changes; this PR does not expose a new write UI. Every SDK leaf checks the binding adjacent to use and after asynchronous reads. The read result checks account scope before returning available content; terminal-context cleanup and lifecycle fault qualification remain follow-up tasks. DLF acquisition and recovery remain unchanged.

## Storage and workflow

For this initial bounded path, text is at most 64 KiB UTF-8 and binary input at most 1 MiB. Prepare one immutable operation ID, timestamp and SHA-256 fingerprints, gzip the bounded bytes, and divide compressed data into at most 256 KiB parts. Codec/hash work is a bounded computational leaf, not a read/check/write workflow. This is not an unbounded upload or image-processing pipeline.

The save statechart owns prepare → intent transaction → parts transaction → read-back → verify → publish transaction. Each transaction uses DLF's resource owner and a mergeable Jazz transaction, because exclusive acceptance requires an online authority. Intent atomically stores operation metadata and an immutable manifest. Parts are locally durable and verified before document/snapshot publication. The immutable document is the publication marker; a manifest with no document remains staging, not complete or available.

Each record uses stable IDs within an attempt. Per-part IDs derive from operation ID and ordinal. No updates, generic upserts or automatic write replay are exposed. The operation row is an immutable journal of intended identity/fingerprint, not proof of completion. Failed/uncertain operations retain their ID and caller content; read/reconciliation may establish a complete matching document but missing local data never proves non-commit. Automatic continuation/replay after uncertain outcomes is outside this capability.

The save actor has independent control/work regions. Shutdown waits for acquired transaction/commit cleanup through DLF and does not start another stage. Returned local success requires all three transactions and read-back verification. Remote acceptance is a separate receipt/machine; rejection does not become a second save. Read states independently verify text and assets. Missing/corrupt byte parts preserve verified text with explicit asset unavailability; they never produce a false offline-complete result. Decompression enforces the original byte limit while reading output.

## Authorization and acceptance

Every row/part is tied to the canonical library and same-library parents at the authority. Immutable rows deny updates/deletes. Tests must exercise forged library/parent references, unrelated-account reads, atomic rejection, exact bytes/hashes, a payload spanning multiple parts, interrupted writes, uncertainty without replay, stale binding results and late remote rejection.

Pending browser acceptance must use the existing production session/root integration plus these production repository machines in an isolated test module. Save previously unuploaded text/bytes while the authority is stopped, close the browser process, reopen the same profile, and verify exact local text/bytes. Reconnect and verify the same immutable record in a separately restored account profile. The web shell remains served; the service worker/offline shell is subsequent work.
