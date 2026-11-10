# macOS extension startup investigation — November 9

The missing toolbar bar is an observed symptom, not an established XState startup
race. Investigation on PR #20 (`b33a22d`) captured a native Chromium/V8 fatal error.
The [further isolation](#further-isolation-connected-local-first-teardown) now
reproduces it with only Jazz and narrows the boundary to page destruction with a
still-connected local-first runtime. No product fix has been applied.

Captured diagnostic:

```text
# Fatal error
# Invoke in DisallowJavascriptExecutionScope
```

Both headless and headed runs of the original extension suite emitted this error
from Google Chrome for Testing. In separate failed toolbar runs, Chrome still
reported the extension installed and enabled, but `Target.getTargets` contained
neither its background service worker nor its offscreen runtime. Even a synchronous
Playwright background-worker probe timed out. The launcher did not report receiving
the toolbar event in those traces. These observations point below the chart's
normal failure/timeout handling; they do not identify the precise engine trigger
or prove that every earlier failure has the same cause.

The bundled test browser is Chromium `156.0.8078.4`, revision `1248`, shipped with
Playwright `1.64.0`. The installed Google Chrome is `157.0.8103.39`. No dependency
or browser package was installed or patched during this investigation.

## Controls and experiments

- Unchanged main `4132edb`, in a disposable source copy with the same installed
  dependencies, passed the first capture case and failed the source-message case
  waiting for the bar (1 passed, 1 failed, 9 not run). The failure therefore also
  exists without this branch's auth implementation.
- An instrumented full suite passed all 11 cases once. That did not establish a fix.
- Repeated fresh-profile capture/security campaigns reproduced the missing worker.
  Holding the toolbar debugging session open and keeping an ordinary browser tab
  open did not eliminate it.
- Disabling Playwright service-worker network inspection yielded 16/16 cases in
  one paired campaign; the identical default-inspection campaign failed on its
  fifth case after four passes. However, the original full suite with only that
  environment override still failed at the first capture in the successive-tabs
  case (7 passed, 1 failed, 3 not run). Do not adopt the override as a proven fix.
- A disposable minimal extension containing only a native toolbar listener and
  DOM injection passed 12/12 fresh-profile cases. It contained no Jazz, XState,
  account restoration or offscreen runtime. It does not yet reproduce the crash.
- The original headless suite with `DEBUG=pw:browser` passed three cases, then
  emitted the V8 fatal error during the offline/restart case and timed out. A
  headed comparison emitted the same fatal error in that case; this is not
  established as headless-only behavior.

The installed Chrome 157 comparison used its explicit `Extensions.loadUnpacked`
API in a disposable profile, without installing a browser or changing the packaged
extension. It passed the first case, then emitted the same fatal error and failed
the source-message case (1 passed, 1 failed, 9 not run). A newer installed browser
and a different loading API therefore do not establish a workaround either.

[Captured native diagnostics](artifacts/extension-v8-fatal-2026-11-09.txt) retain
sanitized excerpts from the headless, headed and installed-Chrome comparisons.

All temporary application instrumentation and experimental settings are removed
after the comparisons. No toolbar gesture or uncertain article write was retried,
no assertion/timeout was weakened, and no product workflow change is justified by
these results alone.

## Mechanism references

[V8's execution source](https://github.com/v8/v8/blob/main/src/execution/execution.cc)
uses this fatal diagnostic when entering JavaScript while execution is forbidden.
This is an engine invariant failure, not an ordinary rejected promise that an
application chart can recover from. The exact native call site remains unproven.

[Playwright's extension guidance](https://playwright.dev/docs/chrome-extensions)
describes retained worker handles across MV3 suspension/restart. Its
[service-worker implementation](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/crServiceWorker.ts)
tracks execution-context destruction/recreation and debugger resumption. A retained
handle alone does not establish that a native worker target is running.

[Chrome's trigger implementation](https://github.com/chromium/chromium/blob/main/chrome/browser/devtools/protocol/extensions_handler.cc)
returns after invoking the toolbar action model. That acknowledgment is not an
application capture/drain acknowledgment. The investigation preserves the real
native toolbar gesture and checks resulting application behavior.

## Initial investigation boundary

There is direct evidence of a native browser-engine failure in the extension
qualification runs. The missing bar can follow loss of the background execution
target; it is not sufficient evidence for changing XState admission, extending a
startup deadline, replaying a gesture, or replacing Jazz account ownership.
The unchanged-main control, headed failure and Chrome 157 failure rule out an
AT Protocol-only or headless-only explanation for this investigation.

The initial minimal toolbar extension did not reproduce the crash. Further work
below now retains a Jazz-only reproducer and controlled cleanup comparisons. The
exact native repair is still unproven; no upstream report, dependency patch,
product change or permanent test workaround has been added.

The latest Linux CI failure for `b33a22d` is separate: image browser tests failed
before the extension step ran. It supplies no Linux extension result for this
commit and must not be represented as the macOS V8 crash.

## Further isolation: connected local-first teardown

The failure is now reproduced without Clipper application code, schema, auth
integration, DLF or XState. The retained
[standalone diagnostic](../../apps/web/tooling/repro-extension-teardown/README.md)
uses only a one-table owner-scoped Jazz backend, the installed SDK, a minimal
extension toolbar listener and disposable profiles. Its frontend runs native Jazz
account operations and acknowledges its write before closing the page. It performs
one toolbar gesture per case and never replays a write.

The final standalone campaigns ran under the pinned Node `24.22.2`, with Jazz
`2.0.0-alpha.60` and bundled Chromium `156.0.8078.4` on macOS arm64. Results are
counts of missing toolbar effects; every failed case below also emitted the exact
native V8 fatal diagnostic. [Structured results](artifacts/jazz-only-teardown-results-2026-11-09.json)
retain the campaign counts.

| Variant                                                              | Cases | Missing toolbar effects | Native fatal errors |
| -------------------------------------------------------------------- | ----: | ----------------------: | ------------------: |
| Connected local-first; abrupt page close                             |    24 |                       4 |                   4 |
| Unsubscribe query, then close page                                   |    24 |                       6 |                   6 |
| Await native `session.close()`, then close page                      |    24 |                       0 |                   0 |
| Device-only (`serverUrl: null`); abrupt close                        |    24 |                       0 |                   0 |
| Connected local-first, no restoration; abrupt close                  |    24 |                       5 |                   5 |
| Connected local-first, no restoration or live query; abrupt close    |    24 |                       6 |                   6 |
| Connected thin client, no restoration or live query; abrupt close    |    24 |                       0 |                   0 |
| Connected local-first, no restoration/query; await `db.disconnect()` |    24 |                       0 |                   0 |

The reduced crash therefore does not require account restoration, a live query,
AT Protocol, or Clipper's statecharts. The current evidence isolates the boundary
to destroying a page with a still-connected local-first/Wasm runtime. Native
session shutdown or native disconnection before page destruction prevented the
crash in these bounded controls. This does not prove a specific Rust/C++ call
site, universal browser behavior or a permanent product workaround. Thin mode is
only a diagnostic control and does not satisfy Clipper's offline requirements.

Earlier controls on the real app also distinguished the actual settings owner
from an unrelated open tab: keeping the settings page alive passed eight cases;
closing it failed on case three after two passes. With identical temporary
instrumentation, the ordinary close failed immediately, while awaiting application
drain passed eight cases, and application drain plus native session close passed
eight cases. Those hooks and all modified application/test source are removed.
The standalone diagnostic is the only retained executable addition.

### Ownership implications

`Account.svelte` currently starts a Window-owned application actor and registers
its cleanup as a Svelte component teardown callback. The retained startup registry
owns the native session beyond an attachment. Component detach and native session
closure are separate lifetimes; stopping subscriptions alone is not an SDK close
acknowledgment. The web worker host already models application drain, acquisition
settlement and native session close explicitly.

The SDK's installed `session/state.js` closes a session by detaching it, waiting for
pending operations and calling the old client's `shutdown()`. `Db.disconnect()`
awaits its connection's native disconnect. These are real lifecycle operations,
not interchangeable with dropping an actor reference or letting a Window disappear.
The experiments call them while the page is still alive; browsers cannot generally
be assumed to await arbitrary application promises after a user closes a page.

The investigation recommended reusing the worker-owned account runtime for
extension settings, preserving native draining/close acknowledgment and keeping
domain work outside the disposable UI Window. The implementation and bounded
qualification are recorded in the 2026-11-10 follow-up below.
The standalone reproducer is also suitable evidence for a Jazz/browser lifecycle
report; no upstream issue or message has been posted.

Existing repository patches remain applied to installed Jazz. The reproducer adds
no patch and does not establish the result of an unpatched-distribution comparison.
Native frontend connection lifetime is the isolated boundary; the exact upstream
repair still needs a qualified implementation or maintainer analysis.

## Worker migration and preserved SDK storage (2026-11-10)

Settings and sign-in use dedicated workers sharing the web worker host and its
application-drain/native-session-close handshake. Connection confirmation remains
in the existing worker-side sign-in chart, with Chrome messaging as a Window-only
adapter so trusted-page sender checks stay intact. The popup closes after native
session closure. Confirmation admission stops when the host begins draining.
The hidden offscreen capture runtime retains its existing ownership; this is not
a claim that every extension workflow has moved out of Window.

The first migration attempt exposed a separate account-selection mismatch: the
shared web worker uses `jazz-account-selection-v2:<endpoint>:clipper`, whereas
alpha.60's default browser store uses
`jazz-account-selection-v1:<registry>:clipper`. Settings restored into the former,
while the offscreen runtime read the latter. Both contain Jazz's native selection
representation; the mismatch was the storage key.

With explicit user approval, extension workers now use the existing SDK key and
Web Lock name. The registry URL comes from Jazz's public `accountRegistryUrl`;
the endpoint scope follows the pinned SDK's browser scope. Jazz still owns stored
selection serialization and transformations. Existing extension selections are
read in place, without copying, rewriting or migrating them. Web storage keeps
its existing key. Native compatibility tests create a selection through Jazz's
default browser store, reopen it through the worker store, then reopen a worker
selection through the default store, covering endpoints with and without a
trailing slash.

Qualification: all 12 packaged-extension cases pass, including the original 11
and the new campaign described below. Coverage includes original
gesture continuation after restoration, account switching, cancellation, private
reading, full browser restart while offline, and reconnect without gateway
refetch. A new 24-cycle settings-teardown campaign also passes: each cycle opens
a fresh settings worker, waits for usable recovery controls, asserts zero Window
WASM calls, closes the settings page abruptly, captures a distinct article using
the real toolbar, and verifies the confirmed connection is unchanged. Chromium
lifecycle diagnostics for this campaign contain no V8 fatal error. This is bounded
macOS/Chromium evidence, not a repair or universal safety claim about Jazz's native
Window teardown. The retained Jazz-only reproducer remains useful upstream.

The extracted shared worker host separately passes six browser-worker cases and
all eight production offline cases, including linked, existing and expired
credentials with full browser restarts. Native/unit coverage now contains 663
tests in 106 files. No dependency or patch changed. Hosted live-provider consent
and Linux extension qualification remain separate checks.
