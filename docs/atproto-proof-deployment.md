# AT Protocol proof deployment

PR #20 now follows the Jazz alpha.60/Vercel baseline from `main`.
Better Auth and the existing AT Protocol plugin use `jazzAdapter` from
`jazz-tools/better-auth-adapter`. There is no Postgres connection, Neon account
requirement, or separate SQL migration step.

## Storage and permissions

Auth data uses the same backend-owned Jazz store as Clipper. On Vercel, Jazz
owns its configured sandbox and persistent drive. Local development uses the
existing SQLite store. The backend accesses auth records through `jazz.db`;
all six `better_auth_*` tables deny client reads, inserts, updates and deletes.
The AT Protocol plugin's OAuth state and provider sessions use this adapter too.

`apps/web/tooling/generate-auth-schema.mjs` generates the schema from the installed
Better Auth and AT Protocol plugin metadata. It opens no database. When updating
these dependencies, regenerate the schema and review its accompanying client-denial
policies in `permissions.ts`.

## Environment

Keep the existing Vercel/Jazz deployment configuration from `main`, plus these
server-only auth settings:

- `AUTH_BASE_URL`: the stable HTTPS origin used for the OAuth round trip, with no path.
- `AUTH_SECRET`: a random secret of at least 32 characters. Keep it stable across deploys.

`AUTH_DATABASE_URL` is no longer read. It can be removed from deployment settings.
No Neon database or stored records have been deleted by this code change.

Auth must start and return on the same deployment origin. The existing
attempt-bound callback receipt remains required; an older session cookie alone
cannot prove that a new OAuth attempt succeeded.

## Existing proof accounts

This change does not import the old disposable Postgres auth records. A fresh
Jazz auth store does not recognize those sessions. Existing library data must
not be silently reassigned based on a matching handle or email.

## Verification

The callback regression uses the actual Jazz adapter and SQLite store, including
closing and reopening the backend between new-user and returning-user callbacks.
This verifies durable backend auth storage; it does not replace an actual provider
round trip or the connected-account offline browser restart gate.

## Native account following

The user approved using Jazz's native account logic on November 9. The default
`createJazzClient` account following is retained: a user without a Jazz account
links the local guest, while an existing user opens their account. Clipper no
longer maintains JWT sources, a remembered provider/account selection, or separate
connect/sign-in commands. Jazz owns persistence and reopening of its selected
account. No `followBackendUser` patch or parallel auth activation record is used.

The worker owns the AT Protocol authorization request and callback confirmation.
Before the Window adapter navigates to the provider, the existing worker host
waits for application drain, acquisition settlement and SDK close. Sign-out drains
the library, clears the Better Auth cookie, then calls the native Jazz logout.
Jazz may also follow backend identity changes independently; this implementation
does not claim to intercept all SDK-initiated account switches or repair the SDK's
published pending-write/account-switch limitations.
