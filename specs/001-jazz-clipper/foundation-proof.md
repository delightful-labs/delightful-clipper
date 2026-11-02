# Foundation integration proof — first bounded experiment

**Date**: 2026-11-02
**Result**: Five scenario groups passed against an isolated local Jazz authority. This partially qualifies the proposed storage boundary; G1 remains open.

## Artifact and environment

Executable [private-library.ts](https://github.com/delightful-labs/delightful-clipper/blob/422ceffcb640f3d70a0bdf68bd5f7ac0aed719de/scripts/proofs/private-library.ts), with [reproduction instructions](https://github.com/delightful-labs/delightful-clipper/blob/422ceffcb640f3d70a0bdf68bd5f7ac0aed719de/scripts/proofs/README.md). It uses only the SDK's public schema/runtime/testing exports and Node assertions. The three-table fixture has a library owner, immutable creation-operation marker and owner-inherited byte assets. This fixture does not freeze the production Clipper schema.

The disposable working directory linked the existing dependency tree at `/Users/matt/Projects/delightful-finances/node_modules`; no dependency installation or legacy package/config change occurred. Jazz was 2.0.0-alpha.59; TypeScript was 6.0.3. Runtime Node 25.2.1; the planned Node 24 target still requires qualification. Strict TypeScript source check passed with dependency declaration checking skipped.

A sandboxed run initially failed to bind the server listener (`Operation not permitted`). An elevated rerun was automatically approved and passed. That is a local fixture permission issue, not an SDK authorization failure. The local server and SDK context shut down at the end; no user library or external deployment was touched.

## Observed results

| Scenario group | Observed result |
| --- | --- |
| Owner begins exclusive transaction, stages library and matching creation marker, commits and awaits confirmation | Both rows readable with expected owner/reference. |
| Owner persists byte asset; unrelated local-first account reads library, marker and asset | Owner reads expected bytes; unrelated reads return null. |
| Unrelated account creates library for owner or inserts asset under owner's library; owner attempts ownership transfer | Authority rejects each mutation. Optimistic local staging is not mistaken for acceptance. |
| Owner stages valid library plus invalid foreign-owned marker in one exclusive transaction | Commit rejected; authority-confirmed reads find neither row. |
| Owner stages a mergeable transaction then rolls back before commit | Rollback returns true; authority read finds no workspace. This does not assert physical erasure of pending local traces. |

## What remains unproven

- DLF package integration/private creation actor, new-account provenance and account-to-library discovery.
- Same-operation crash/restart reconciliation and concurrent two-device first-library creation.
- Browser local-tier durability, offline cold reopen, storage eviction and restored-account access on another device.
- The complete production schema, parent/reference policy coverage, deletion and late rejection behavior.
- Native/browser extension packaging, gateway request authentication and Netlify runtime/network enforcement.

The SDK's policy helper uses synthetic local-first proofs, a local authority and memory-backed clients. Its server-side denials are stronger evidence than UI filters or stubs, but do not qualify the complete production topology. No application workflow or user-facing bootstrap was implemented.

## Subsequent investigation

The [completed investigation](investigation-results.md) now adds packaged DLF/browser/Chromium-extension evidence and a canonical-root design. The [implementation handoff](implementation-handoff.md) defines the next production batch. The paragraph below records the original next-proof recommendation, now partly satisfied.


Qualify browser persistence/session restoration with the packaged DLF boundary and minimal record set, then exercise cold reopen and interrupted-commit reconciliation before expanding to capture. Do not mark G1 complete solely from this result or copy this procedural experiment into a production async workflow; the DLF resource statechart remains the implementation design.
