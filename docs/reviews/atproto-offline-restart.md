# AT Protocol offline restart qualification

Consolidated 2026-11-07. The previous JWT and native experiment reports are preserved in the local consolidation archive. Current findings and evidence are in [the research summary](../atproto-research.md#offline-evidence-and-usability-gate).

Offline restart remains a usability gate: reopen the same library in a fully restarted browser with app/auth/Jazz endpoints unreachable; retain acknowledged offline edits through another restart; repeat with expired credentials and with a fresh-profile existing-account sign-in; reconnect to the same authority without losing or duplicating work. Explicit sign-out must not restore the previous selection.

The native source experiment passed these synthetic local cases on its pinned, patched SDK. That is historical evidence, not qualification of this branch’s JWT runtime, alpha.60, a hosted deployment, real provider consent or an upgrade of existing data. Retest the integration produced by the upgrade agent before claiming usability. Do not restore the experiment’s linked SDK, runtime patches, vendored package, server fixture or deployment recipes as the implementation baseline.

## Native alpha.60 update — 2026-11-09

The current implementation uses Jazz’s native account following and Better Auth’s
Jazz adapter. The earlier JWT/selection runtime is removed. Current ownership and
qualification are recorded in [the native auth review](atproto-native-alpha60.md);
previous experiment evidence remains historical.
