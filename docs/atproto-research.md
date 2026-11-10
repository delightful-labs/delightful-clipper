# AT Protocol: consolidated research and decisions

Consolidated 2026-11-07; implementation status updated 2026-11-10 after PR #20 merged.
The [current specification checkpoint](../specs/001-jazz-clipper/atproto.md) separates delivered identity behavior, accepted publication requirements and remaining work.

Historical consolidation on `research/atproto-jwt-proof`. This is the entry point for the AT Protocol research. It replaces the overlapping offline/hosting/Jazz investigation reports and publication-question checkpoints from the separate experiment worktrees. Merged PR #20 replaces the historical JWT/Postgres proof with the alpha.60 backend and Jazz Better Auth adapter; see [deployment notes](atproto-proof-deployment.md). Integration qualification remains open.

## Current direction

Use Jazz for application data and sync. AT Protocol identity is optional, and public publication is independently optional. People start in a usable local library without signup. DLF owns reusable identity/lifecycle integration; Clipper owns its entities, annotation relationships and publication policy; DUI owns generic controls. Private backup is independent of public AT records.

Jazz alpha.60 and the Vercel backend are adopted, and PR #20 implements native Jazz-backed authentication. Continue using Jazz’s standard account/session lifecycle rather than restoring the old JWT coordinator. Publication remains design/research work until its open choices and implementation are approved; the existing backend does not itself supply a qualified publication scheduler.

Keep these detailed documents:

- [Companion Lexicon](reviews/clipper-companion-lexicon-proposal.md): reviewed companion fields, schemas, relationships and remaining choices.
- [Publication technical proposal](reviews/margin-sync-technical-proposal.md): common-record mapping, candidate execution/evidence and statechart. Only its explicitly approved subset is selected.
- [Accepted product decisions](../specs/001-jazz-clipper/design-decisions.md#accepted-margin-public-representation--2026-11-07) and [data model](../specs/001-jazz-clipper/data-model.md#at-protocol-identity-boundary): authoritative product requirements, not implementation-completion claims.

## Shared public content

Use Margin’s unified `at.margin.note` for the shared quotation/commentary. An article note is source-linked text; a bare highlight has a quotation/selector; a highlight with an attached note combines quotation and commentary in one Margin annotation. Independent local highlight/note identities remain intact.

AT Lexicons are not all-or-nothing application dependencies. We can use selected record types and optional fields, while preserving required fields and their meaning. Other apps gain the shared portion they understand; they need not implement Clipper’s full local model. A Clipper record with similar fields is not automatically discoverable as a Margin record. Reading a subset is easier than safely editing it: preserve additional valid fields rather than serializing only the fields our UI displays.

Margin revision 4 at commit `27146212068968bfb506554332430d127d33644c` requires motivation, target and creation time; commentary and selectors are optional. Source inspection confirms its combined quotation/commentary representation. Its narrow Go update serialization may discard unknown top-level fields, strengthening the case for companions rather than custom fields inserted into Margin records. No live Margin UI interoperability was proved.

The inspected Semble ingestion at `029e4e349c49e2b72aca63830c435e0c2d9cbe3d` only imports Margin bookmarking creations and ignores updates; it does not establish general highlight/note round trips. Standard.site’s modular vocabulary illustrates partial adoption but is not selected for highlights. Spaces/private PDS storage remains deferred; draft access control is not E2EE or guaranteed erasure of downloaded copies.

Sources: [Margin schema](https://github.com/paddinglabs/margin/blob/27146212068968bfb506554332430d127d33644c/lexicons/at/margin/note.json), [Semble ingestion](https://github.com/cosmik-network/semble/blob/029e4e349c49e2b72aca63830c435e0c2d9cbe3d/src/modules/atproto/application/useCases/ProcessMarginNoteFirehoseEventUseCase.ts), [Lexicon specification](https://atproto.com/specs/lexicon), [companion guidance](https://atproto.com/blog/pinned-posts), [Spaces proposal](https://github.com/bluesky-social/proposals/blob/fcad6b9388149990551a2bfeebfa5210ae97c0c5/0016-permissioned-data/README.md).

## Accepted publication behavior

| Area                      | Accepted decision                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Originals                 | Jazz remains source authority; local IDs are distinct from DID, public URI and content CID.                                                                                                                         |
| First publication         | Explicitly confirmed for the selected item/destination. If edited before issue, publish its latest eligible saved version.                                                                                          |
| Source acceptance         | AT writes wait for Jazz server acceptance of the relevant source; local editing stays available offline.                                                                                                            |
| Ongoing changes           | Jazz edits update the public copy automatically. Adding a first note to an already-public bare highlight updates that annotation automatically.                                                                     |
| Remove only attached note | Keep the Margin address and quotation; update it to a bare highlight.                                                                                                                                               |
| Root deletion and Trash   | Request public deletion. A local deletion is not a confirmed PDS deletion or network-wide erasure.                                                                                                                  |
| Restore                   | Previously published items republish at their original public address; unpublished items stay unpublished. Do not bypass explicit unpublish or external conflict/deletion pauses.                                   |
| Unpublish                 | Keep local content, request public deletion and stop outgoing sync until explicit publication again.                                                                                                                |
| Foreign content edit      | Pause; compare preserved versions. User may publish the reviewed Clipper version, explicitly apply the reviewed public version locally, or leave paused. Recheck that the reviewed versions are still current.      |
| Foreign deletion          | Keep local originals and pause. Recreation requires explicit choice; later edits/reconnect/restart do not recreate automatically.                                                                                   |
| Foreign metadata          | Preserve valid non-content additions, such as public tags, and continue; not every unknown field is harmless.                                                                                                       |
| Organization              | Clipper tags stay private. Do not import public tags into private organization.                                                                                                                                     |
| Note bounds               | Both 3,000 grapheme clusters and 10,000 UTF-8 bytes. Oversized paste remains intact in a recoverable draft until shortened before save.                                                                             |
| Quote bounds              | New highlights fit both 1,500 grapheme clusters and 5,000 UTF-8 bytes. No silent splitting/truncation.                                                                                                              |
| Surrounding context       | Include in preview; each side fits both 150 graphemes and 500 UTF-8 bytes, keeping nearest complete graphemes.                                                                                                      |
| Companion fields          | Separate public highlight/note records with required `subject` (Margin URI/CID) and `article` URI; optional reciprocal `note`/`highlight` links. No private Jazz IDs.                                               |
| Group synchronization     | Conditional repository batches, durable attempt evidence and reconciliation before replay. Companion conflicts pause the outgoing group; stale observations require verification, not destructive automatic repair. |

The approved companion family results in two records for an article note or bare highlight, and three for a highlight with commentary. Text is shared through Margin rather than duplicated in companions. Public relationship disclosure belongs in the publication preview.

The actual namespace, precise key/discovery convention, private intent/binding/attempt schemas, executor scheduling, companion-only deletion/cleanup, progressive consent and oversized existing/imported content handling remain open. The companion document distinguishes those proposals from approved fields. Do not infer installation, schema publication or implementation approval from product approval.

## Jazz platform reuse after the upgrade

Read the complete [alpha.60 release](https://github.com/garden-co/jazz/releases/tag/v2.0.0-alpha.60), published November 7 at 18:58:24 UTC. Source inspected at `1449644f42bd3d21a5cc843b4bea0a57da4a27c7`; npm package integrity was verified. Recheck the actual installed version after the other agent’s work.

| Facility            | What to reuse or review                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend auth        | Existing Better Auth session feeds `createJazz.authenticate`; mount `/jazz`. No browser JWT/JWKS bridge is needed for external-user Jazz auth; guests retain their local signing identity.                                  |
| Native session      | Keep atomic first-use account adoption, selection persistence, account commands, shutdown/retry and database replacement under Jazz.                                                                                        |
| Local-first client  | Explicit module loading is required; initial background upgrade means session-ready alone is not proof of durable local readiness.                                                                                          |
| Plain-text merge    | `s.string().merge("text")` and `editedFrom` can simplify concurrent notes. Overlapping replacements may select a later edit for that part, with the other accepted version in history.                                      |
| Editor binding      | `jazz-tools/text-field` handles echoes, input-method composition and selection. It expects immediate writes, conflicting with the existing 500 ms source debounce; review before adoption. No rich-text editor is required. |
| History             | Native accepted-version history may replace duplicate accepted-revision machinery. Pending/rejected drafts are not in history; recovery remains separate. Current read access also grants access to past versions.          |
| Anchors             | Native quote/context ranges report confidence/ambiguity. Compare them before building another locator; account for source/reader differences and UTF-16 versus code-point coordinates.                                      |
| Backend domain work | Same-process jobs can use the server database. Public PDS mutations still need consumer authority/attempt/recovery policy. A backend does not imply continuous scheduling on every host.                                    |

Sources: [client/session construction](https://github.com/garden-co/jazz/blob/1449644f42bd3d21a5cc843b4bea0a57da4a27c7/packages/jazz-tools/src/session/create-jazz-session.ts), [Better Auth integration example](https://github.com/garden-co/jazz/blob/1449644f42bd3d21a5cc843b4bea0a57da4a27c7/examples/auth-betterauth-chat/src/lib/jazz.server.ts), [text editing](https://github.com/garden-co/jazz/blob/1449644f42bd3d21a5cc843b4bea0a57da4a27c7/docs/content/docs/recipes/data-patterns/collaborative-text-editing.mdx), [text-field code](https://github.com/garden-co/jazz/blob/1449644f42bd3d21a5cc843b4bea0a57da4a27c7/packages/jazz-tools/src/text-field/index.ts), [history](https://github.com/garden-co/jazz/blob/1449644f42bd3d21a5cc843b4bea0a57da4a27c7/docs/content/docs/reading/history.mdx), [anchors](https://github.com/garden-co/jazz/blob/1449644f42bd3d21a5cc843b4bea0a57da4a27c7/packages/jazz-tools/src/runtime/text-anchors.ts).

### Remaining coordination, without inventing another session

Jazz automatically follows backend identity on startup, focus, cross-tab changes and auth refusal. `linkGuestOnSignUp: false` only controls linking to an unassigned user; it does not suppress sign-in to an existing user. Our confirmation/cancellation and app-operation ownership requirements still need to fit that standard lifecycle. The backend auth admission point is a candidate place to coordinate them; no new cookie, table or exact handoff process is selected.

The rejected two-factory proposal omitted important safeguards: `ensureAutomaticLocalFirst` is internal/unexported, `settleSelection` is marked internal, and direct account-manager/database composition needs its own auth recovery and session compatibility. Public exports alone did not establish a sufficient adapter. Our old manual-mode patch also fails a textual applicability check against alpha.60; preserving or porting it is not the default plan.

Sources: [watcher](https://github.com/garden-co/jazz/blob/1449644f42bd3d21a5cc843b4bea0a57da4a27c7/packages/jazz-tools/src/session/backend-watch.ts), [atomic startup](https://github.com/garden-co/jazz/blob/1449644f42bd3d21a5cc843b4bea0a57da4a27c7/packages/jazz-tools/src/accounts/persistence.ts#L305), [selection durability](https://github.com/garden-co/jazz/blob/1449644f42bd3d21a5cc843b4bea0a57da4a27c7/packages/jazz-tools/src/accounts/state.ts#L109), [direct-context auth custody](https://github.com/garden-co/jazz/blob/1449644f42bd3d21a5cc843b4bea0a57da4a27c7/packages/jazz-tools/src/accounts/context.ts#L209).

## Offline evidence and usability gate

The JWT branch’s earlier online sign-in/reload success is not offline qualification. The native experiment subsequently exercised the production shell, service worker, Clipper schema, DLF owners and real WASM/SQLite persistence with synthetic provider/article fixtures:

- A founding guest linked to a backend user; a fresh browser signed into that existing account without transferring a recovery secret.
- Expired cookies and stopped app/Jazz services did not prevent cold Chromium process reopening to the same reader/account.
- Locally acknowledged offline favorite/status edits survived another offline process restart; reconnect preserved one article and two operation rows.
- Explicit sign-out prevented restoration despite a still-valid provider cookie.

That result used commit `11bcbf6367e62eca399d13da1fda939b2ae6ef36` plus the manual-follow patch and matching native/WASM artifacts through the SDK correctness harness. The final report records an 11.6-second browser run, 49 Clipper lifecycle and 64 DLF regressions. These are historical reports, not tests rerun during consolidation. Real provider consent, parser behavior, existing-store migration and deployed hosting were not qualified on that cohort.

The early remote Jazz Cloud probe failed with a migration-graph 404 while a matching local-core SDK check passed. This predates the released integration and must not be presented as current Cloud incompatibility. No paid service was provisioned as part of that investigation.

The merged alpha.60 integration has since passed all eight production offline cases, using real Jazz/Better Auth persistence and synthetic provider identities; extension restart and 24 settings-teardown cycles also pass. Hosted live-provider consent remains unverified. See [the current evidence and limits](../specs/001-jazz-clipper/atproto.md#verification-and-limits).

The continuing qualification contract is full browser-process restart with app/auth/Jazz unreachable, identical library/content and acknowledged edits surviving another restart, expired credentials, fresh-profile existing-account sign-in, reconnect and explicit sign-out. Preserve local/remote/unknown outcomes separately. [Qualification checklist](reviews/atproto-offline-restart.md)

Alpha.60’s full known-issue list includes pending-write loss in a waiting-tab reload, rapid guest signup staying thin, expired/revoked sessions with pending work, and wiping during offline account switching. Other disclosures concern recoverable signup/signout errors, silent socket delays, JWT-key rotation, large-transaction stalls, machine-client socket limits and a platform-specific upload cap. Treat these as concrete qualification cases, not reasons to build a parallel storage platform or claims that our integration has fixed them. Upgrade wire/storage changes also require preserving pending old-client work; no migration is authorized here. [Release and upgrade details](https://github.com/garden-co/jazz/releases/tag/v2.0.0-alpha.60)

## Boundaries and what remains deferred

AT sign-in does not grant repo-write authority. Publication needs reviewed scopes for Margin and the selected companion collections, verified destination DID and current access. Existing OAuth-plugin progressive-consent support still needs qualification. No cross-app cookie, duplicate identity registry or new OAuth stack is selected.

DLF can reuse safety lessons from backup work—binding/generation, exact coverage, retained unknown outcomes and credential exclusion—without making its restore journal a live publication queue. A public repo export does not cover private Jazz originals/assets. Public content is not encrypted from operators, and a PDS deletion request cannot erase all downstream copies.

The app backend’s `accountFor`/request-user helper does not automatically authorize guest capture. Preserve the no-signup parser behavior when adopting the released integration. Also read tagged examples alongside declarations: some examples still name removed helpers. The alpha.60/Vercel baseline has now landed; the native auth update uses it.

## Consolidation and resumption

The November 9 native implementation supersedes the JWT proof code while retaining the historical [OAuth ownership review](reviews/atproto-attempt-refactor.md) and [startup restoration review](reviews/atproto-startup-restoration.md). The later machine audit’s counterexamples are already addressed by the subsequent commits/tests in this branch; its stale test additions are not reapplied.

The redundant offline and machine-audit worktrees, their uncommitted source/tests/reports and the target’s pre-consolidation state were checksum-archived locally before cleanup. A verified Git bundle preserves the AT-related branch refs and commit history. The archive excludes reinstallable `node_modules` and Git worktree pointer files; it retains other files, including ignored local artifacts. Recovery metadata stays in that private local archive, not in the repository. No remote branches or deployments are changed by cleanup.

Resume from the [current remaining-work list](../specs/001-jazz-clipper/atproto.md#work-remaining), using the merged native integration. Review the remaining publication choices before implementation. Do not restore obsolete linked SDKs, patched bundles, Render recipes or experimental server fixtures merely to reproduce our earlier architecture.
