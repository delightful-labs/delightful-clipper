# Archived Jazz alpha.59 schema history and deployment tooling

Original migrations, schema snapshots and Netlify/Jazz Cloud deployment tooling are preserved
from commit `f1e41b0`, before the alpha.60 migration. These files are reference material, outside
active application source, type checks, lint/format passes, unit tests and deployment commands.
Use the original Git revision in an isolated checkout to reproduce that environment. Do not run
these old scripts against a live service or rebuild the retained Netlify artifact with alpha.60.

The current application starts from its explicit alpha.60 schema with `migrations: 'none'`.
The current-SDK historical lenses and schema witnesses still required by active regression tests
live under `apps/web/tests/fixtures/schema-history/`. Those fixtures test historical transformations
within alpha.60; they do not qualify opening an alpha.59 database file in alpha.60.
Future application schema changes need a migration chain from the actual alpha.60 database baseline.
The application's saved-article `snapshots` table is domain data and is unaffected by this cleanup.

The archive can be removed later after historical reproduction and rollback requirements are retired;
Git history preserves its source. Active regression fixtures require separate review before removal.
