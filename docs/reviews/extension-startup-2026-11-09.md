# macOS extension startup investigation — November 9

The missing toolbar bar is an observed symptom, not an established XState startup
race. Investigation on PR #20 (`b33a22d`) captured a native Chromium/V8 fatal error:

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
application chart can recover from. The triggering subsystem remains unproven.

[Playwright's extension guidance](https://playwright.dev/docs/chrome-extensions)
describes retained worker handles across MV3 suspension/restart. Its
[service-worker implementation](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/crServiceWorker.ts)
tracks execution-context destruction/recreation and debugger resumption. A retained
handle alone does not establish that a native worker target is running.

[Chrome's trigger implementation](https://github.com/chromium/chromium/blob/main/chrome/browser/devtools/protocol/extensions_handler.cc)
returns after invoking the toolbar action model. That acknowledgment is not an
application capture/drain acknowledgment. The investigation preserves the real
native toolbar gesture and checks resulting application behavior.


## Conclusion and next boundary

There is direct evidence of a native browser-engine failure in the extension
qualification runs. The missing bar can follow loss of the background execution
target; it is not sufficient evidence for changing XState admission, extending a
startup deadline, replaying a gesture, or replacing Jazz account ownership.
The unchanged-main control, headed failure and Chrome 157 failure rule out an
AT Protocol-only or headless-only explanation for this investigation.

The exact trigger is still unresolved. The minimal native-toolbar extension did
not reproduce it, and the stack has unsymbolized JavaScript/Wasm addresses. Do not
assign the trigger to Jazz, Playwright network inspection or a particular state
transition without a smaller reproducer. The useful next step is to reduce the
real settings/restoration/teardown and worker lifecycle while preserving this
exact fatal diagnostic, then test that reproducer with browser/Jazz maintainers.
No upstream report has been posted, and no dependency patch, product change or
permanent test workaround was added.

The latest Linux CI failure for `b33a22d` is separate: image browser tests failed
before the extension step ran. It supplies no Linux extension result for this
commit and must not be represented as the macOS V8 crash.
