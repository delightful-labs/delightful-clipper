# Image browser CI investigation — 2026-11-10

The [failed browser job](https://github.com/delightful-labs/delightful-clipper/actions/runs/42820750879/job/129906022889)
passed account/discovery coverage, then failed the image retry case: after the
mocked HTTP 415, both observed image rows remained pending. The next two cases
timed out. Tooling, types and build passed in the same workflow attempt.

## Reproduction and cause

Initial ordinary, slow-CPU and controlled-response local checks passed. Bounded
state-only console diagnostics then caught the original failure locally, including
the two subsequent timeouts. Repeating just the first two image tests reproduced
the failure on the third fresh run.

The image-failure domain read and staged the update successfully. Its transaction
reached `persistingLocal`, then reported a native Jazz protocol error: a write's
base names another node's commit that the store cannot resolve. The rollback
subsequently reported an already-committed transaction. These are not evidence
that the failure row was safely published. The existing transaction/queue charts
preserved an unresolved outcome and withheld ordinary retry for that image;
the queue's next fetch concerned the other image. The first assertion therefore
cannot be repaired by pretending the pending row is failed or by replaying the
uncertain update.

The old fixture authored the article, image declarations and parent records
through a second Window-side Jazz client. The application worker then updated
those rows. This crossed two foreground writers in one account before the image
assertion; it was not the app's ordinary Add Link path. The local source
investigation located the corresponding unresolved-base refusal in Jazz's core
sync-conflict logic. No claim is made that Clipper has repaired that SDK boundary.

## Scoped fixture correction

Image tests now create their articles through the real Add Link UI and the
application worker. Only resolve/extract responses supply the existing synthetic
content and image declarations; image fetching, native storage, processing,
failure/retry, reader rendering and remote propagation still use their original
paths. The unused Window-side seed writer is removed. Its separate read-only
observer remains for the native row assertions.

Existing assertions and deadlines are unchanged, including independent-client
restoration, a complete browser-process restart without Jazz, image format/size
checks, text/selection preservation, authentication refusal and source-URL
isolation. No application source, auth policy, dependency, SDK patch or stored
data shape changes are part of this CI follow-up.

On failure only, the test reports at most 100 machine-state observations and
already-sanitized technical error messages, plus whether Retry is visible. It
does not capture context, event payloads, content, recovery phrases or credentials.

## Qualification and remaining limit

All four corrected image cases pass locally. The formerly failing first-two-test
sequence also passes eight independent fresh runs (16 cases) with the new fixture.
The matching original sequence reproduced the refusal in three runs. Linux CI
still needs to qualify the published change.

This correction qualifies the normal application workflow. Jazz alpha.60's
multi-foreground-writer refusal remains a separately reproduced SDK issue;
cross-client mutable-row writes must not be called fully qualified from a green
single-writer fixture. No upstream issue was published and no dependency patch
was added or changed.

## Subsequent Linux account failure

Run `42843116790` passed tooling/types/build but failed earlier in the account
suite, before reaching images. Its first failure was the independent restored
profile returning null after an offline save and a full browser-process restart;
the original profile's local reopen assertions had passed. Later account cases
failed after Playwright replaced the failed worker and its shared fixture core.
The same complete web sequence passed all 55 cases locally.

The browser fixture's `createLibraryRecords` call still omitted the native
connection observer that production now supplies. It now uses the identical
`readConnection` adapter; query-only/server fixtures continue to omit it. Missing
test reads report only their outcome kind, retaining evidence for another Linux
failure without exposing content or account identifiers. Four fresh repetitions
of the offline-save/independent-profile case pass locally with this wiring. The
new Linux run must establish the outcome; this does not qualify the separate
Jazz multi-writer issue.

## Linux extension qualification reached

Run `42845035130` at `77cf813` passes tooling/types/build, the complete main web
suite, schema migrations, dedicated-worker cases and complete offline suite.
It then fails three extension restoration cases: the signed-out popup does not
close within its existing deadline, and two setup helpers observe “Updating your
account…” with no confirmed connection. Nine extension cases pass; sample-data
checks are not reached. The same 12-case packaged-extension suite passes locally.

The extension test build now enables the shared, sanitized state observer through
the existing `PUBLIC_DEBUG` setting. Sign-in/confirmation charts have stable
diagnostic IDs; bounded console evidence captures their state paths and technical
errors on failure. No deadlines or account workflow decisions change. Linux
evidence is still required to distinguish restoration, Chrome confirmation and
native shutdown settlement; this diagnostic addition is not an extension repair.
