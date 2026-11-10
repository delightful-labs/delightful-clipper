# Attempt-bound OAuth and account ownership

Approved protocol: operation + library ID + random attempt ID in tab storage.
OAuth carries the attempt ID through validated state in a relative return path.
Only a successful callback mints a signed HttpOnly receipt, bound to the newly
issued session user and expiring after ten minutes. Completion checks the current
session, then clears the receipt. Existing login alone cannot authorize mutation.
No new database tables, packages, or user-visible strings.

DLF owns the reusable coordinator: waiting, reading/saving intent, authorizing,
navigating, validating completion, consuming intent, dispatching and settling.
Provider transport, storage key, messages and domain policy are injected. Failed
intent removal blocks mutation. Consumed intent cannot replay an issued mutation.
Terminal states distinguish success, cancellation, failure, unresolved mutation,
and failed cleanup. Results carry attempt IDs. Exact SDK session binding remains.

Clipper's lifecycle owner invokes both account and OAuth actors, owns resume,
and joins shutdown. Components only bind dependencies, subscribe and send events.
Clipper owns local-only admission, library drain and post-drain revalidation.
Shutdown before issue reports cancellation; after issue waits for SDK settlement.
A rejected SDK promise does not establish rollback and reports unresolved.

Checks: interrupted OAuth with older session, forged/expired receipts, changed
session, failed callback, stale results, cleanup failure, signed-in admission,
binding replacement, delayed bootstrap and shutdown during drain/SDK mutation.
