# Active historical-schema regression fixtures

These are test inputs, not the production application's migration chain. The schemas and migration
lenses are compiled with the pinned alpha.60 SDK and used by the native migration tests and the
Chromium/Firefox schema-upgrade tests. The legacy JSON witness is also consumed by a native test.
Keep the fixtures independent of changes to the current application schema.

The original pre-upgrade files are preserved in `archive/jazz-alpha59/` at the repository root.
These tests verify transformations and refusal behavior within alpha.60, not an in-place alpha.59
native database upgrade. Production still declares `migrations: 'none'` for its fresh alpha.60 target.
