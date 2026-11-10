# Workflow hardening implementation progress

## Worktrees and baselines

- Clipper: `/Users/matt/Projects/worktrees/delightful-clipper/workflow-hardening`, branch `feat/workflow-hardening`, based on main `168cd0b` (PR #20 merged).
- DLF: `/Users/matt/Projects/worktrees/delightful-local-first/domain-transaction-workflow`, branch `feat/domain-transaction-workflow`, based on main `9d2b0f6`.
- Specification: [workflow ownership hardening](../../specs/001-jazz-clipper/workflow-ownership-hardening.md), copied from documentation branch `cd85d97`; its implementation map and all acceptance criteria remain authoritative.

## Qualified transaction bridge

Change set A has started with extraction of the generic domain transaction bridge
into DLF. The DLF worktree contains:

- `src/lib/contracts/domain-transaction.ts`: generic attempt, assessment, result,
  resource lifecycle and typed domain spawn contracts.
- `src/lib/machines/workspaces/domain-transaction.ts`: extracted private controller
  and public lifecycle wrapper over the existing DLF transaction owner.
- New `transactions/contracts` and `transactions/workflow` package exports.
- `docs/domain-transaction.md` and its consumer-guide link: ownership protocol,
  existing API compatibility and behavioral qualification requirements.

The extracted chart preserves the original bridge sequencing. Resource and
receipt types are generic; it has no Clipper or concrete Jazz imports. Existing
workspace APIs are unchanged. The public actor accepts only cancellation/shutdown;
the controller owns the domain child through processing and releases its reference
on exit. The native transaction owner continues through settlement.

The user reviewed the bridge implementation and approved continuing. The
domain-free tests and public package-consumer fixture are now implemented.
Clipper's 358-line local bridge is replaced by a 34-line typed adapter preserving
its native resource, write and receipt defaults.

The web and extension pin the same alpha.60 archive. It adds the two shared
modules and public exports; the existing pnpm recovery-view patch applies
separately during installation. A byte-level comparison verifies all baseline
module files are unchanged. The reproducible
builder is `tooling/build-domain-transaction-vendor.py`; exact source hashes and
baseline/archive hashes are recorded in `vendor/domain-transaction-provenance.json`.
The rebuilt archive hash is
`388faab60b1c2848b16e03f29d4038f30c5ff75874f58c4f08da73c01e22569b`.

## Validation

- DLF workspace transaction and scoped-form selection: **247 tests passed in ten
  files**, including the new protocol scenarios and independently modeled
  interruption campaign (seed `20261110`, 150 runs).
- DLF `check:library`, `package` with strict publint, and the full `check:consumer`
  command passed, including the new public runtime/type fixture.
- Clipper `pnpm check`: web and extension checks passed with zero Svelte errors
  or warnings.
- Clipper `pnpm test:unit`: **663 tests passed in 106 files**, including native
  listener tests run through the local terminal.
- Clipper production build passed using a synthetic Vercel preview environment.
- Clipper worker browser suite: **six tests passed**, including worker-only domain
  saves, identity reuse, shutdown drain and stale-intent refusal.
- Clipper packaged extension suite: **12 tests passed**, including offline save,
  browser restart, restoration and sign-in cancellation.
- Clipper production offline suite: **eight tests passed**, including linked,
  existing and expired-credential accounts across two complete offline browser
  restarts, persisted offline edits, reconnection, cold reader reopen with both
  servers stopped, and shell update failure/recovery. Both Netlify fixture builds
  passed; the separate Vercel preview build passed as recorded above.
- Vendor integrity/import checks, lint, changed-source formatting and whitespace
  checks passed in their respective repositories. Rebuilding the archive yields
  the same hash.

Clipper's pnpm commands use the repository-managed Node `24.22.2` (verified with
`pnpm exec node --version`), even though the interactive shell uses Node 25.
A clean offline installation verifies package/lockfile compatibility, bridge
module bytes and recovery-view patch application in both consumers. The first
worker run was interrupted after Vite
refused dependency assets symlinked from another worktree; a private dependency
tree now replaces those temporary setup links. Unit/native tests run without
deployment flags; synthetic Vercel flags apply only to the production build.

## Qualified operation supervisor; consumer migration pending

DLF now has `contracts/owned-operation.ts` and
`machines/lifecycle/owned-operation.ts`, with `lifecycle/operation/contracts` and
`lifecycle/operation/workflow` exports. The public owner invokes a private
controller around one typed spawn capability. Its active/draining states retain
the same child and lifecycle subscription; normal settlement stops both and
clears their references. Completion preserves the child's exact output and
operation identity; failure preserves facts for the parent's existing uncertainty
policy. No retry, transaction or remote-acceptance policy moves into this owner.

`DRAIN` waits without commanding the child. `INTERRUPT` forwards one supported
typed command and waits. The first request wins. Save/organization/sample callers
will forward shutdown; image and reader writes will retain their wait-only
policy. Child reports remain private to the controller. DLF's
`docs/owned-operation.md` records the architecture, all ten caller mappings and
the required qualification campaign.

After the user approved testing, **32 supervisor tests passed**. Together with
existing workspace/domain-transaction/scoped-form regressions, **279 tests pass
in 12 files**. The independent generated campaign uses seed `20261111`, 300 runs
and at most 12 commands per run, with full model event/state/transition coverage.
Targeted tests cover startup and subscription failures, synchronous/undefined
output, request races, pure `can()` calculation, wrong-child reports, reference
release, actual unsubscribe/disposal and pre-start/forced-stop behavior.

Composed tests use the actual DLF transaction owner with controlled native leaves
to verify custody transfer during acquisition/read/stage/commit/local persistence,
cancelled local settlement, drain-only completion, unknown outcomes and no replay
or remote-acceptance wait. Strict test TypeScript, `check:library` (zero Svelte
errors/warnings), packaging with strict publint, lint, formatting and whitespace
checks pass. The full DLF `check:consumer` passes, including public protocol types
and A → B → A parent invocations that verify exact child input/generation and
receipt identity. No production correction was required.

No Clipper source or pinned archive uses the new supervisor yet. Clipper's earlier
browser/native/offline results apply to the shared transaction bridge. DLF tests
with controlled leaves do not replace the actual consumer qualification gates.

## Remaining implementation

Migrate the ten supervision blocks, rebuild the compatible artifact, and qualify
the actual consumer graph. Reader input
preparation must move before invocation so the actual child receives the exact
issued change, rows and operation ID under v6 ordering. The remainder follows the
dependency-ordered implementation map. SHARE-1/2 and DLF-1/2/4/5 remain open.
The full specification and its runtime/offline/extension acceptance criteria
remain authoritative.

The user authorized committing this qualified work. DLF source and tests are
committed as `9b3f094` on `feat/domain-transaction-workflow`. The compatible archive
records that exact source revision alongside its source hashes. Clipper's
qualified bridge integration is being committed before caller migration.
Neither branch has been published. DLF's AGENTS.md retains its implementation
review and test gates for subsequent library changes. No unidentified server was
stopped or unrelated source worktree modified.
