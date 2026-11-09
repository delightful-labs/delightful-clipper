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

All 54 general web regressions pass. Eight historical-schema browser cases pass in
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

All eleven packaged extension cases pass after a clean rebuild without diagnostic
hooks, including account restoration, successive captures, offline capture through
browser restart, reconnect, sign-in cancellation and stale connection rejection.
The retained source uses one shared schema and Jazz’s shipped migration graph.
Schema-separation experiments and temporary diagnostic hooks are not included.
