# Native alpha.60 auth update

The November 9 direction is to use Jazz's native account following. This supersedes
the manual JWT linking, persistent selection and Clipper connect-versus-sign-in
workflow reviewed in the older proof documents. Publication/lexicon research is
unchanged. Neon resources are untouched; the application no longer reads a
Postgres connection or includes the Postgres driver.

## Owners and effects

- The existing backend owns Jazz storage and Better Auth's native Jazz adapter.
  Generated auth tables deny all client access; privileged auth reads and writes
  remain server-side.
- The worker's provider chart owns authorization, secure redirect validation,
  attempt-bound callback confirmation, failure and request cancellation. Idle
  startup performs no provider call. It never creates or links Jazz accounts.
- Jazz's native client follows the verified backend cookie, including guest
  linking, existing-account sign-in and its remembered-account persistence.
- The worker host admits provider intent under the current scope and stops
  accepting application commands before drain. Application settlement and actual
  SDK close precede the navigation message. Native transaction custody prevents
  a clean-close acknowledgment. The Window adapter only executes navigation.
- The application invokes the sign-out child after its normal library drain.
  Provider failure prevents native logout. Parent shutdown retains the invocation
  until its issued operation settles.

## Qualification boundaries

Native callback tests use the installed provider plugin and real Jazz adapter,
including closing/reopening SQLite between new-user and returning-user callbacks.
Permission tests exercise real backend policies with guest and external clients.
The production offline browser fixture uses synthetic provider identity but real
Better Auth cookie verification, Jazz linking, built workers and persistent browser
profiles. It does not establish that a live provider consent screen succeeds.

Jazz can initiate account changes through its own backend watcher. Clipper uses
that behavior instead of claiming it can hold every switch behind an app-specific
drain. The SDK's documented account-switch/pending-write limitations remain
qualification constraints. Browser persistence and remote acceptance are separate.

## Verified November 9

`pnpm verify` passes: vendor checks, formatting, lint, strict web/extension/service-worker
types, 653 unit/native tests and the production build. The separate Vercel-targeted
build passes and includes the Jazz auth adapter, provider plugin and parser worker.

All eight production offline cases pass directly on the retained branch and merged
main baseline, including its self-hosted fonts. Native linked and fresh-profile existing accounts retain the same
article and reader through two complete browser-process restarts with web/auth/Jazz
servers unreachable and the HTTP cache cleared. An offline favorite survives the
second restart and reaches the authority after reconnect. Expired backend sessions
retain offline reading/editing; after reconnect and fresh authentication the same
library and pending edit return. Actual provider-cookie sign-out followed by a cold
offline restart does not restore the prior account.

All 55 general web regressions pass on main’s drawer-navigation baseline. Eight historical-schema browser cases pass in
Chromium and Firefox; the separate native SQLite regression covers the backend auth
migration. Six worker-boundary/shutdown cases pass. These browser runs
use an isolated source copy with only port numbers remapped because the default
test port was occupied. Dependencies are cloned into that copy so its Vite worker
serving boundary remains intact.

The preparation chart distinguishes account replacement from a failed setup that
only replaced the same account’s thin binding. An old guest failure cannot mark
Jazz’s newly opened backend account as unavailable. A different backend account
can still receive its own local persistence setup; an already prepared replacement
can proceed. Same-account setup failure does not loop through repeated upgrades.
Both boundaries have regression tests. Provider logout uses Better Auth's JSON
request contract; signed-in capture uses its cookie rather than demanding a
nonexistent Jazz bearer.

Live AT Protocol consent and the deployed preview's environment remain separate
hosted checks. Existing Neon records are not imported or deleted. No release claim
is made about every SDK pending-write/account-switch edge case.

## Open extension regression

The packaged extension is not qualified on the final merged tree. Two earlier
retained-source runs passed all eleven cases (one without diagnostic hooks), but
final rebuilt runs still fail intermittently at cold offscreen startup or account
restoration. The latest full run passed two cases and failed nine, beginning with
the toolbar’s missing status bar. A separate run first failed because Playwright’s
service-worker handle restarted. After a test failure, the fixture restarts its core
while the web backend remains alive; subsequent restoration failures therefore do
not independently establish nine application defects. Unchanged main passed all
eleven cases in a control run.

The underlying startup failure remains unresolved. Do not treat the earlier green
runs as qualification of this final tree or claim the complete integration usable.
Schema-separation experiments and temporary diagnostic hooks are not retained.
The native auth web/offline evidence above remains valid and independent of this
packaged-extension issue. Live provider consent is also still a hosted check.

## XState 6 refresh (November 9)

Merged main `4132edb` (PR #28), including published `xstate@6.0.0-beta.1`,
main's matching DLF/DUI archives and generated lifecycle campaigns. The AT Protocol
and provider-first sign-out charts now use v6 schemas, async logic and queued
parent reports. Authorization and callback payloads use state input; the preparation
state retains the original account/binding as a typed fact so a stale guest failure
cannot poison Jazz's replacement account. Native observations, session adoption,
account scopes, transaction custody and drain acknowledgments follow main's runtime.

OAuth attempt identity is issued by an owned async actor. Admission probes are
pure: repeated `.can()` checks issue neither an identity nor an HTTP request.
Cancellation still aborts the provider request, callback confirmation remains
attempt-bound, and navigation waits for clean application drain and native close.
Provider-cookie clearance still precedes native Jazz logout.

Vendor integrity, formatting, lint and strict web/extension/service-worker types
pass. All 661 unit/native tests in 105 files pass, including the generated campaigns.
The full native schema/migration bundle validates with 20 tables; its existing
`storageOperations.createdAt` provenance warning remains. All eight production
offline cases pass directly on this merged worktree, including linked, existing
and expired-session accounts across full browser-process restarts, retained offline
edits and reconnect reconciliation. No temporary source copy or port remapping was
needed for these runs.

All 55 general web cases, eight historical-schema cases in Chromium/Firefox, six
worker cases and two fake-data cases pass directly on this worktree. The Vercel
production build passes with a synthetic preview deployment hostname; this checks
packaging without accessing the hosted environment.

The existing user-approved Better Auth plugin compatibility patch is unchanged.
It adapts the plugin's older account lookup to Better Auth 1.7's account-key API;
this merge adds no dependency patch or XState declaration override. Native Jazz
continues to own account following and durable auth storage, without Neon.

The rebuilt macOS extension passed the first toolbar capture case, then failed
the source-message/navigation case waiting for its toolbar bar. The run used
`--max-failures=1`, so the other nine cases did not run. This reproduces the earlier
startup/bar symptom without establishing its cause. No assertion was removed or
weakened. The macOS packaged-extension qualification caveat and live-provider
consent check remain open; the XState update does not resolve or waive them.

## macOS extension investigation follow-up

The [startup investigation](extension-startup-2026-11-09.md) reproduces the missing
bar on unchanged main and captures a native Chromium/V8
`Invoke in DisallowJavascriptExecutionScope` fatal error in headless, headed and
installed Chrome 157 comparisons. The exact trigger remains unresolved. Tested
inspection/window-lifetime changes did not establish a reliable workaround. All
temporary source edits are removed; no dependency patch or product change is
proposed on the basis of a timeout alone. The extension remains unqualified.

The further investigation now retains a standalone SDK-only reproducer. It
reproduces the V8 fatal error on abrupt teardown of connected local-first sessions,
even without restoration or live queries. Awaiting native close/disconnect,
device-only sessions and thin-client controls each had zero failures in their
24-case campaigns. See the detailed matrix in the startup investigation. This
narrows the ownership boundary without qualifying a product workaround; no
application, dependency or default test behavior changed.

## Extension worker and storage follow-up (2026-11-10)

The settings/sign-in migration supersedes the open macOS qualification caveat
above for the tested packaged-extension flows. Both disposable pages now own no
Window Jazz runtime. Their workers reuse the existing drain/native-close host
and the extension's SDK account-storage key; web storage is unchanged. All 11
original extension cases and a 24-cycle settings-close/toolbar campaign pass,
including offline browser restart and account restoration. See the
[startup investigation](extension-startup-2026-11-09.md) for the exact scope,
storage compatibility evidence and limits. This does not establish an upstream
native teardown repair or Linux extension qualification. Hosted live-provider
consent remains unverified.

## Hosted live-provider follow-up — 2026-11-10

The production OAuth round trip now passes on merge `168cd0b`, deployment
`dpl_5qUpzSiG7Y8APNfgrW1rSQgQ9XD9`. After explicitly approved production auth
configuration, the user signed in at the real Bluesky provider in an isolated
visible Chromium context. Clipper returned an authenticated session, and three
reloads retained the same remembered Jazz account and visible library. This
supersedes the earlier unverified-consent caveat for this particular round trip.

The check used existing Playwright because Chrome MCP could not connect. The
browser was closed after verification; no credentials or authentication state
were saved as artifacts. Live-identity full-process/offline restart, refresh,
revocation, backend restart and returning-device checks remain distinct from
this result. See [the current spec](../../specs/001-jazz-clipper/atproto.md#hosted-live-provider-check--passed-2026-11-10).

## Sign-in qualification follow-up — PR #32, 2026-11-10

The existing nine native callback, completion, migration and configuration tests
pass again on Node `24.22.2`. Three additional session lifecycle regressions use
the installed Better Auth server, actual Jazz adapter and disposable SQLite
stores. They verify that a due app session renews without changing identity and
retains its renewed expiry after backend restart; expired and explicitly revoked
app sessions remain rejected after restart without deleting their user. These
checks pass without a product change, SDK patch, new dependency or test auth route.
They do not establish live AT Protocol access-token refresh or provider revocation.

All 21 account browser cases pass locally, including the offline-save/full-process
restart/independent-restoration case. Linux CI run `42851581957` at `9a09485`
failed that case's independent-profile read, then failed eight later cases.
Tooling/types/build passed. One rerun of the failed browser job has passed the
complete web suite and reached schema tests; later steps are still in progress.
The passing rerun does not explain or resolve the intermittent Linux failure.

The deployed PR preview initially returned `503 invalid_auth_configuration` with
the missing field names `AUTH_BASE_URL` and `AUTH_SECRET`. These previously approved
settings are now scoped to preview branch `test/atproto-cold-reader`, using its
stable branch origin and an independent sensitive preview secret. Redeployment
`dpl_6QtwDidBv7Qr87LJL4J7n685wNsk` serves unchanged commit `9a09485`; its session
endpoint returns HTTP 200. Production configuration is unchanged.

The authenticated Chrome session reaches the actual preview, but its Jazz backend
cannot open: the SDK-generated preview drive name exceeds Vercel's 64-character
limit. The app already supports the native `CLIPPER_JAZZ_CORE_NAME` override.
Selecting `clipper-atproto-pr32` for this branch's disposable preview store is
awaiting user approval. No override or new store has been selected yet. Fresh
returning-provider sign-in, the normally deployed reader repair, hosted backend
restart, live refresh and revocation checks remain pending behind this blocker.
The separate Linux extension recovery issue and its three user-approved temporary
skips remain deferred.
