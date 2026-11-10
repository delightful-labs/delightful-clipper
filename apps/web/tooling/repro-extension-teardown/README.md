# Connected Jazz session / Chrome extension teardown reproducer

This manual diagnostic is independent of Clipper's application, DLF and XState.
It creates a disposable one-table Jazz backend, an extension with a native toolbar
listener, and fresh browser profiles. The options page opens a Jazz local-first
session, optionally restores an account, acknowledges a write, and optionally
starts one live query. It then closes and exercises one real native toolbar
command. A missing DOM effect is counted, and `DEBUG=pw:browser` exposes the native
V8 fatal diagnostic when present.

The fixture table and generated extension identity are disposable test inputs,
not a proposed Clipper schema or account process. Secrets stay in each isolated
browser profile and are never printed. Temporary profiles, generated bundles and
the local backend are cleaned up on normal completion. No product assertion,
retry, deadline, dependency patch or default test configuration is changed.

From the repository root, using its installed dependencies and Chromium:

```sh
DEBUG=pw:browser pnpm exec node --experimental-strip-types \
  apps/web/tooling/repro-extension-teardown/run.ts > /tmp/jazz-teardown-abrupt.log 2>&1
```

The backend binds an available loopback port. `CASES` defaults to 24 and is bounded
to 1–100. The runner exits with status 1 for missing toolbar effects or setup errors;
a failure count alone is not proof of a V8 crash. Check the log for:

```text
# Fatal error
# Invoke in DisallowJavascriptExecutionScope
```

Controls (prefix the same command with the selected variables):

| Variable                 | Change                                                                            |
| ------------------------ | --------------------------------------------------------------------------------- |
| `CLOSE_MODE=abrupt`      | Leave the native session running before closing the page (default).               |
| `CLOSE_MODE=unsubscribe` | Unsubscribe the query before closing, leaving the session running.                |
| `CLOSE_MODE=session`     | Unsubscribe and await the native `session.close()` before closing.                |
| `CLOSE_MODE=disconnect`  | Await native `db.disconnect()` before closing without closing the session.        |
| `THIN_ONLY=1`            | Use the thin client, omitting the local-first loader; diagnostic only.            |
| `OFFLINE_ONLY=1`         | Use `serverUrl: null`; the local source page is still used for the toolbar check. |
| `RESTORE=0`              | Skip native account switching/restoration.                                        |
| `SUBSCRIBE=0`            | Skip the live query.                                                              |

Thin and device-only modes cannot be combined. Thin mode is not an offline-capable
application alternative.

For example:

```sh
CLOSE_MODE=session DEBUG=pw:browser pnpm exec node --experimental-strip-types \
  apps/web/tooling/repro-extension-teardown/run.ts > /tmp/jazz-teardown-session.log 2>&1
```

The runner copies the installed Jazz broker and its matching WASM binary into the
disposable extension and bundles only the SDK fixture client. It does not build or
load Clipper. Existing repository patches remain applied to installed packages;
this is not an unpatched-package comparison. No new patch is applied. The fixture
also uses the existing `esbuild` and Playwright installations, not downloaded
replacements.

Use the investigation's measured results and limits in
[the review](../../../../docs/reviews/extension-startup-2026-11-09.md), rather than
interpreting a bounded green control as release qualification or adopting a
cleanup mode as a product workaround.
