# Quickstart and validation guide

**Status**: Tooling, session/recovery and the private library root are implemented. The current storage PR adds bounded text/byte repository capabilities. See [tasks.md](tasks.md) for completed checks and open qualification; capture, reader and release acceptance remain unbuilt.

## Current review

Subsequent to the planning phase, an isolated [foundation proof](foundation-proof.md) was implemented and run. See its recorded environment/results and [reproduction instructions](https://github.com/delightful-labs/delightful-clipper/blob/422ceffcb640f3d70a0bdf68bd5f7ac0aed719de/scripts/proofs/README.md). It does not add the proposed application scripts below or qualify the full MVP.

Read [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md) and [contracts/](contracts/). Follow the [implementation handoff](implementation-handoff.md) for the now-ready first bounded batch; G1–G6 remain acceptance gates before dependent behavior is enabled or released. Record target browser/device versions after validation, not from assumed support.

## Prerequisites for the implementation phase

- Node 24 LTS and pnpm 10.22.0; exact frontend/adapter lock aligned with DLF/DUI peers.
- A packaged DLF artifact exposing the granular entry points and matching DUI dependency; owner-scoped Jazz schema deployment and private-account credentials handled through DLF.
- Netlify development/preview environment with the authenticated, public-only first-party fetch boundary enabled. No production deployment or account mutation is implied by this guide.
- Chrome desktop and Firefox/macOS extension packages with explicit host permissions and trusted session UI. Android Chrome PWA installation; iOS Safari Add Link fallback.

Tooling now provides root `pnpm dev`, `pnpm build`, `pnpm preview`, `pnpm check`, `pnpm lint`, `pnpm format:check`, `pnpm verify:vendor` and `pnpm verify`. Node 24.22.2/pnpm 10.22.0 and the lockfile are pinned. Run `pnpm test:unit` for machine and native authorization/repository tests and `pnpm test:e2e` for Chromium session/root integration tests. Tests start disposable local Jazz authorities; they require permission to bind local ports. Extension builds and gateway serving remain subsequent work. The shell is not the completed reader.

## Future acceptance scenarios

1. **Capture/identity**: Add a public article, then its short-link/direct equivalent. Observe redirect evidence and one library document; duplicate stays in previous status and offers Open. Unknown canonical declarations never silently merge unrelated pages.
2. **Offline cold reopen**: Wait for local text and image confirmations; disconnect, close and reopen the PWA. Open article text, downloaded images, notes and highlights. Pending assets remain explicit. Shell cache alone must not pass this case.
3. **Failed/partial capture**: Use unavailable and partial-content fixtures. Retain source URL with useful failure/partial status. Retry updates the same capture without losing readable content or annotations. Network recovery retries are bounded.
4. **Source/reader annotation**: Select text crossing links and inline markup on the source, explicitly highlight, then find the same ID/quote in Reader where exactly resolvable. Repeated quotes with insufficient context remain ambiguous; changed text may remain unresolved. No repair, resizing or refresh screen required.
5. **Notes/sync**: Edit the single article note and single highlight note offline. Confirm local save independently from sync; restart and inspect draft retention. Reconnect a second same-account client and verify convergence. Another account cannot read rows/bytes. Simultaneous edits must not silently destroy authored text.
6. **Organization**: Individual status/favorite/tag changes; global tag rename/delete; explicit tag-result semantics. Trash/restore preserves the full record graph, default search excludes it, explicit Trash search finds it. Confirm permanent-delete wording and reconnect tombstones. Highlight-delete Undo restores the same identities; broad Undo/bulk not expected.
7. **Search**: Query article and note/highlight text offline, including after edits/deletes; rebuild an incompatible/stale index without losing source data. Account change clears worker index and prevents old results from appearing.
8. **Reader**: Continuous scrolling, TOC/footnote popover, four typography controls, saved theme and preferences, normal browser link behavior and position restoration. No presets/custom fonts/zoom viewer. Remote reading-position update never moves an active article.
9. **Extension lifecycle**: Suspend background runtime during a capture, wake it, reconcile the durable operation and avoid duplicates. Restore the same account in trusted extension UI through DLF; inspect packaged CSP/WASM without leaking secrets through page messages.
10. **Mobile/deployment**: Install Android PWA and share one URL through supported intake; preserve it during session startup. Use iOS Add Link fallback. Preview offline shell/worker/WASM assets under actual Netlify routing and CSP.

## Validation reporting

When implementation is authorized, record commands, package versions, device/browser versions, fixture set, observed results, and remaining failures. Evaluate SC-003's 90% rate against a declared representative set, counting ambiguous/unresolved outcomes honestly. Accessibility checks cover keyboard focus, touch, zoom/reflow, labels, contrast and overlapping annotations; avoid CSS-class assertions. Current implementation evidence and outstanding scenarios are tracked in [tasks.md](tasks.md).
