# AT Protocol implementation and remaining work

Updated 2026-11-10 against merged [PR #20](https://github.com/delightful-labs/delightful-clipper/pull/20),
merge `168cd0b` including fix `152d679`. This is the current Clipper checkpoint;
older JWT/Neon/source-build experiments are historical. Product decisions below
are accepted requirements, not claims that publication has been implemented.
Shared identity/lifecycle belongs to DLF; Clipper owns annotations and publication.
The PR #32 follow-up below records implemented reader work awaiting merge and
normal deployment verification; it is separate from the merged baseline.

## Implemented identity integration

| Area | Merged behavior |
| --- | --- |
| Platform | Jazz `2.0.0-alpha.60`, XState `6.0.0-beta.1`, existing Vercel app/backend. |
| First use | A usable local library without signup. Optional AT Protocol sign-in is available in account settings. |
| Provider | Better Auth `1.7.18` with `@kingironman2011/better-auth-bsky` `0.3.2`. The previously approved compatibility patch adapts its older account lookup to Better Auth's account-key API. It is not an AT Protocol protocol change. |
| Durable auth | Jazz's native Better Auth adapter stores users, sessions, OAuth state and provider sessions in the existing backend store. Six generated auth tables deny all client CRUD; native migration preserves the pre-auth library. No Neon, Postgres driver, SQL migration or browser JWT/JWKS bridge. Old disposable Neon records are neither imported nor deleted. |
| Account lifecycle | Jazz owns automatic guest linking, existing-user selection and remembered-account persistence. No parallel Clipper identity registry, manual connect/sign-in coordinator or custom selection record. This does not implement local-work transfer/merging. |
| OAuth ownership | The worker owns provider requests and attempt-bound completion. An old cookie alone is not a new callback receipt. Application drain, acquisition settlement and actual native session close precede navigation. |
| Sign-out | Drain the library, clear the app's Better Auth cookie, then perform native Jazz logout. A provider failure does not authorize proceeding as if sign-out succeeded. No global cross-app logout claim. |
| Extension | Settings and recovery sign-in use workers and the existing trusted-page Chrome confirmation adapter. Popup close waits for native session closure. They preserve Jazz's existing extension selection key and Web Lock; web storage remains unchanged. The hidden offscreen capture owner is retained. Direct AT Protocol provider sign-in in the extension remains deferred. |

Implementation: [auth server](../../apps/web/src/lib/server/auth/server.ts),
[Jazz backend](../../apps/web/src/lib/server/jazz.ts),
[provider chart](../../apps/web/src/lib/machines/runtime/atproto.ts),
[worker host](../../apps/web/src/lib/runtime/worker/host-machine.ts),
[extension account worker](../../apps/extension/src/account-worker.ts).
Configuration and native migration instructions are in [deployment notes](../../docs/atproto-proof-deployment.md).
The app still uses the existing DLF startup/readiness/restoration adapters; this
consumer implementation does not establish a reusable, independently adopted DLF
AT Protocol provider/server package or Finance integration.

## Verification and limits

Recorded local evidence for `152d679`: 663 unit/native tests in 106 files, six
worker-browser cases and 12 packaged macOS/Chromium extension cases pass, with
strict types, lint, formatting and vendor integrity. Extension coverage includes
restoration, account switching, cancellation, offline full-browser restart and
reconnect, plus 24 repeated settings-close/real-toolbar cycles with unchanged
connection and zero Window WASM calls. SDK/worker selection round trips cover
existing keys with and without trailing slashes.

The shared worker refactor also passed eight production offline cases: linked,
fresh-profile existing and expired-credential accounts reopen the same cached
library with app/auth/Jazz unreachable, retain acknowledged edits through another
full process restart and reconcile after reconnect. Native callback tests use the
installed plugin and actual Jazz adapter, including SQLite backend reopen. Browser
provider identities are synthetic; this is not a hosted live-provider consent test.

See [native auth qualification](../../docs/reviews/atproto-native-alpha60.md) and
[extension investigation](../../docs/reviews/extension-startup-2026-11-09.md).
CI for `152d679` passed tooling/types/build, but [the browser job](https://github.com/delightful-labs/delightful-clipper/actions/runs/42802719477)
failed at `pnpm test:e2e`, before its extension step. A later PR #32 run reached
the extension suite and exposed the known Linux failure recorded below.

The original Jazz-only Window-teardown reproducer remains evidence of an upstream
boundary, not a repair to Jazz itself. Linux extension CI, further hosted lifecycle
qualification, cross-app Finance adoption, and all published Jazz
pending-write/account-switch caveats remain separate qualification gates. Do not
claim complete integration/release readiness from these local passes.

### Known issue: Linux extension recovery sign-in — 2026-11-10

[Linux CI run 42845035130, browser job 129930124826](https://github.com/delightful-labs/delightful-clipper/actions/runs/42845035130/job/129930124826)
on PR #32 commit `77cf813` passed tooling/types/build, web browser tests, schema
migrations, dedicated-worker tests and the full offline restart suite. The packaged
extension suite passed nine cases and failed three:

- Signed-out toolbar capture: after submitting a valid recovery phrase, the sign-in
  popup did not close within the existing 15-second wait.
- Stale connection for another account: setup did not obtain a confirmed
  `clipper.connection` within the existing five-second assertion.
- Repeated settings teardown/capture: setup failed at the same confirmation step.
  Both setup failures showed “Updating your account…”, no alerts and no Chrome
  local-storage keys.

All 12 packaged extension cases pass locally on macOS/Chromium. The Linux cause
remains unresolved: the evidence does not locate the stall in restoration,
connection confirmation or shutdown settlement. This is Jazz recovery-phrase
sign-in through the extension's trusted page; direct AT Protocol provider sign-in
in the extension remains deferred. Diagnostic follow-up is not an established fix.
At the user's request, commit `07acf39` temporarily skips these three cases on
Linux, retaining them on macOS and leaving the other nine enabled on Linux.
A green run with these skips does not establish a repair or Linux qualification.

Linux extension qualification and complete release readiness remain blocked by
this issue. Passing web/native offline evidence remains valid within its tested
scope. Further investigation is deferred pending a separate scope discussion.

### Hosted live-provider check — passed 2026-11-10

Production deployment `dpl_5qUpzSiG7Y8APNfgrW1rSQgQ9XD9` serves merge `168cd0b`
on `https://clipper.delightfullabs.com`. Production-only `AUTH_BASE_URL` and a
new sensitive `AUTH_SECRET` were configured with user approval; neither secret
nor browser credentials were written to the repository. Session and OAuth client
metadata endpoints return HTTP 200 with the canonical production callback.

A separate visible Chromium context reached the actual Bluesky provider. The
user completed sign-in there; the callback returned to Clipper, the session
endpoint reported an authenticated user, and three subsequent reloads retained
the same remembered Jazz account and a visible library. Chrome MCP was
unavailable, so this check used the existing Playwright installation. The test
browser was closed afterward; no password, cookie, token or recovery material
was captured in the evidence.

This passes the hosted provider round trip and same-account reload check. It
does not establish a new browser-process/offline restart with that live identity,
backend restart durability, refresh/revocation, another-device returning sign-in,
or public repository permissions. The eight synthetic-provider offline cases
above remain separate evidence.

### Live-identity offline follow-up — 2026-11-10

The real-provider profile subsequently passed two complete offline browser-process
restarts with network/DNS blocked and HTTP cache cleared. Both reopened the same
account and readable marked article. A favorite added offline survived the second
restart and reached a fresh local replica after reconnect; opening the article
from that replica's library rendered the saved text. Extraction was synthetic,
while authentication and Jazz persistence/sync used production. The fresh replica
reused only this app's session in memory; this was not another-device OAuth login.

A separate production reader failure was reproduced: direct URL navigation in a
fresh replica reported unavailable while online, whereas library navigation worked.
Investigation confirmed that a temporary snapshot miss while Jazz was connecting
became a terminal reader result. [PR #32](https://github.com/delightful-labs/delightful-clipper/pull/32)
implements the approved reader-owned connection wait and one further local-first
read. Cached reads remain immediate; cancellation, account scope and listener
cleanup stay explicit. This is an application fix, not an SDK patch.

The implementation passed `pnpm verify` (683 unit/native tests), eight offline,
six worker and seven reader browser cases. The actual built worker passed the
original failure scenario and three reloads in each of two isolated fresh contexts
against production using local asset substitution. Those checks did not deploy
the repair. Normal PR deployment/merge verification remains open. See the
[reader investigation and qualification](../../docs/reviews/reader-direct-open-2026-11-10.md).
The marked article remains private and the native test profile stays local.

## Accepted publication behavior — not implemented

- Jazz is the source authority. Initial publication is explicit and previewed;
  unpublished items stay unpublished. Later source updates synchronize after
  relevant Jazz server acceptance, without a separate confirmation per update.
  Offline publication intent follows the latest saved item before issuance;
  each issued request retains its exact source version and destination.
- Use the shared `at.margin.note` quotation/commentary representation alongside
  separately addressable Clipper highlight/note companions. Companions require
  `subject` (Margin URI/CID) and public `article` URI, with optional reciprocal
  `note`/`highlight` links. No private Jazz IDs, drafts or organizational tags.
  Using the shared subset does not require adopting all of Margin's vocabulary.
- A deleted attached note leaves the public bare highlight at its existing
  address. A new note on an already-public bare highlight updates that annotation.
- Trash requests public deletion; restoring a previously published item republishes
  at its original public address unless a conflict/deletion pause blocks it.
  Explicit unpublish preserves local content and stops later synchronization
  until explicit publication. Permanent deletion also retains public-removal duties.
- External content changes pause the group. The user may choose the reviewed
  Clipper version, explicitly import the reviewed public version, or leave it
  paused. External deletion preserves local content and requires explicit
  recreation. Later edits/reconnect/restart do not bypass either pause.
- Preserve valid foreign non-content metadata without importing it into private
  organization. Common/companion changes use the approved conditional grouped
  synchronization approach; companion conflicts pause the whole outgoing group.
  Retain unknown outcomes and reconcile before retry; no cross-service atomicity
  or downstream-erasure guarantee.
- Note bounds: both 3,000 graphemes and 10,000 UTF-8 bytes. New quotations: both
  1,500 graphemes and 5,000 bytes. Public prefix and suffix: each both 150 graphemes
  and 500 bytes, included in the preview. No silent truncation or migration of
  existing/imported content is authorized.

[Accepted decisions](design-decisions.md#accepted-margin-public-representation--2026-11-07)
and [companion approval](design-decisions.md#accepted-companion-fields-and-grouped-synchronization--2026-11-07)
are authoritative. [Technical synchronization](../../docs/reviews/margin-sync-technical-proposal.md)
and [companion schemas](../../docs/reviews/clipper-companion-lexicon-proposal.md)
retain proposals beyond their explicitly approved subsets.

## Work remaining

| Work | Status / next evidence |
| --- | --- |
| Production reader gap | Approved fix implemented and locally qualified in PR #32, including isolated built-worker checks against production. Merge and verify the normally deployed artifact; no production deployment claim. |
| Linux extension CI | Known recovery sign-in failure: run `42845035130` failed three of 12 extension cases after passing web/schema/worker/offline checks. Those three are temporarily skipped on Linux by user request; cause and repair remain unresolved. Latest-head CI still needs confirmation. |
| Hosted identity check | Real-provider round trip/reloads and two live-identity offline process restarts/propagation pass. Native app-session renewal, expiry and revocation across backend restart now pass three added regressions. Fresh returning-provider access, deployed persistence and live provider refresh/revocation remain open; preview auth is configured, but the SDK-generated storage name exceeds Vercel's limit. A branch-only shorter name is awaiting approval. See the current native auth follow-up. |
| Shared DLF adoption | Extract only evidenced reusable provider/server/lifecycle boundaries, review interfaces, then qualify Finance independently with its existing data/backup obligations. No cross-app session/token transfer. |
| Local annotations | Finish independently identified highlights, article notes, attached notes and anchors; existing draft/revision groundwork is not the completed model or editor. Review native text/history/anchor facilities before custom machinery. |
| Public vocabulary | Select the real controlled companion namespace; resolve exact payload/projector, public keys/discovery, anchoring/version rules, and oversized retained/imported content. Example `com.example.*` names are not selected production NSIDs. |
| Public authorization | Qualify least-required collection/operation permissions and progressive consent with the existing OAuth integration. Sign-in does not implement publication or prove write permission. |
| Synchronization design | Review private intent/binding/attempt shapes, server-acceptance evidence, backend writer lifetime/scheduling on Vercel, multi-instance ownership, conflict resolution and companion cleanup. A backend alone is not an always-running scheduler. |
| Publication implementation | Implement reviewed entities/projector, durable public mapping/attempts, conditional group writes/deletes, reconciliation, conflict/deletion pauses and user controls. No PDS publication code or live Lexicon currently exists. |
| Publication qualification | Disposable PDS conditional-write and lost-response cases, unknown-field preservation, complete offline restart/reconnect, deletion/Trash/restore conflicts, and real Margin/second-reader interoperability. No production grants/content needed for initial proof. |
| Deferred scope | Local-work transfer and real merge, broader recovery/unlinking/provider-loss design, extension AT Protocol provider login, private/encrypted PDS storage, restricted audiences and automatic inbound synchronization. |

Recording this checkpoint selects no new data shapes, namespace, executor process,
copy, dependency or deployment. Ask the user before resolving the open design choices.
