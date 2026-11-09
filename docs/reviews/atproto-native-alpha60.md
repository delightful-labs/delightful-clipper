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
