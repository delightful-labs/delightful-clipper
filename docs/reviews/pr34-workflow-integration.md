# PR34 integration and XState review

The workflow-hardening branch incorporates PR34's final head
`78367af8eb0cc77bee18792aee370e8630503ca1` (`test/atproto-cold-reader`), merged into
`main` at `e0856c6f905e8f93b24dc709af36e13c8c2e5f43` during this integration.
The branch is rebased onto that merge; PR33 continues to target `main`.
The pre-rebase tip is `21f5ff3e18e322a463d72e67c56537b0e4ba646f`, retained locally
as `backup/workflow-hardening-pre-pr34-21f5ff3`.

## Preserved sign-in and reader behavior

PR34 adds native provider refresh tests for rotated tokens and `invalid_grant`,
including adapter persistence and backend restart. Those tests and PR34's hosted
authentication evidence are retained unchanged. Its DLF companion PR40 contains
documentation changes and requires no competing source migration. The qualified
DLF archive remains unchanged.

PR34 also fixes shutdown with an attached saved reader. Its earlier publisher
used the UI-ready library selector to track native reader lifetime; that selector
stopped exposing the library before its readers finished draining. PR34 changes
the scan to use the owned library child.

Change set C replaces that publisher scan with chart-owned surface leases.
Each transferred port stays owned through reader shutdown, final-position/write
settlement, fullscreen retirement and the Window's actual `DISPOSED` receipt.
The publisher remains a projection. PR34's real attached-reader shutdown test is
retained to qualify the combined implementation.

Earlier merge resolutions are retained for native account binding and connection
observation, current account settings helpers, packaged-extension interactions
and isolated test authorities. Before the XState corrections below, the combined
working tree was checked against Git's three-way integration of the old tip and
PR34, with C's publisher selected for their single conflicting file.

## XState corrections

| Boundary                | Finding                                                                                                                                                                        | Correction and regression                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Application Worker root | A native subscription's `complete` observer also runs when the root is stopped. The adapter previously sent `CLOSED` or navigation in either case.                             | The host produces an explicit successful closure output only after its shutdown join. The native observer requires that output; a forced stop reports a custody failure. Unit coverage distinguishes stop from successful shutdown; a real Worker/client regression rejects clean closure and native release after forced stop.                                    |
| Window viewport adapter | Both the successful and failed viewport finals triggered `complete`, which previously sent `VIEWPORT_CLOSED` even after the failure report. Stop could also fabricate closure. | Project the successful `closed` terminal state and its output. A stopped actor reports failure; the chart's failed final retains its existing failure event. Native MessageChannel/DOM tests require exactly one failure with no closure on initialization failure, and one closure for normal detach. Actual surface disposal remains a separate acknowledgement. |
| Saved-record reads      | A projection helper and final-entry payloads selected scope-loss outcomes outside the transition that chose the terminal state.                                                | The resource join explicitly guards current scope before entering `available`; missing/corrupt entries report the chart-selected outcome. Existing startup, stale-scope, cancellation and required/optional read-failure regressions remain in place.                                                                                                              |

The installed published XState v6 contract distinguishes native
`subscribe({ complete })` from `enq.subscribeTo(..., { done })`: the latter observes
a completed child. Other scoped account-store, broker and storage native
observers already require their terminal outputs. No mechanical replacement of
all completion observers is needed.

Native maps, response-transfer flags, locks, receipt handles and callback cleanup
remain adapter resources. They do not select sign-in, account adoption or logout
policy. Child read errors intentionally propagate to the owning read chart's
required/optional error handlers; absence of a leaf-local recovery state alone
does not establish missing error handling.

## Qualification boundary

The [checkpoint record](workflow-hardening-progress.md#checkpoint-qualification)
contains final commands and counts for this integration. Validation includes
PR34's provider persistence tests, attached-reader shutdown, the production Worker
transport, packaged extension, production offline restart and schema upgrades.
The final rebase onto merged PR34 was checked against the expected combined tree.
Production, test, tooling and package files are byte-identical to the qualified
tree; only PR34's additional authentication evidence changed. Formatting and
whitespace checks were repeated after the rebase.
No new live-provider rotation or multi-instance claim follows from the simulated
provider tests. Existing platform exclusions remain explicit.

A–D remain complete for Clipper. Reader/search recovery (E), browser jobs (F)
and the remaining broader v6 cleanup (G) retain their existing acceptance gates.
This review does not silently mark those change sets complete.

Subsequent change set E is now qualified in [the reader/search record](reader-search-lifetimes.md); the checkpoint contains current completion status.
