# Technical Plan: Jazz Clipper and Reader

**Baseline**: `main` (implementation through feature branches/PRs) · **Updated**: 2026-11-05 · **Spec**: [spec.md](spec.md)
**Status**: Foundation, URL-first capture, saved reader/offline shell and Chromium direct extension clipping are implemented. PR #13 is merged and user-verified. Basic organization is merged in PR #14 and DUI radio/list refinements in PR #15 (`72b6fc9`). The current combined search/article-tags/Trash batch is described in [search-tags-trash.md](search-tags-trash.md), including pending copy approval; see [library-organization.md](library-organization.md) for the state/resource model and the handoff for qualification. Full runtime/release qualification remains open; see [tasks.md](tasks.md) and [implementation-handoff.md](implementation-handoff.md) for delivered evidence and the next-thread entry point.

## Summary

The product specification is complete; [design-decisions.md](design-decisions.md) records launch interaction defaults and [specification-review.md](specification-review.md) distinguishes specification completion from runtime qualification. The engineering gates apply before dependent workflows are enabled or released; they do not prevent the bounded foundation implementation that produces their evidence. See the [completed investigation](investigation-results.md).

Replace the legacy Svelte 3/Webnative prototype with a Svelte 5/SvelteKit application and Firefox/Chrome desktop extension sharing typed Clipper domain contracts. Use Delightful Local First (DLF) for session/recovery and Jazz for private, account-scoped durable records and native immutable byte assets. Store one immutable readable snapshot per successful clip. Extract browser captures locally where feasible and fetch/parse public Add Link sources through a first-party Netlify boundary. Use XState workflows, worker-based search/image processing, conservative W3C-compatible exact anchoring, and a cached PWA shell.

Preserve the approved reduced MVP: no content refresh/revision migration, highlight resizing, bulk operations/broad Undo, device preference overrides, typography presets, image viewer, or reading-time estimation. Named selector/normalization versions do not imply a version-history feature.

## Technical context

| Area | Decision and evidence |
| --- | --- |
| Language/runtime | Strict TypeScript 6.0.3; Node 24.22.2 and pnpm 10.22.0 pinned. DLF/DUI accept Node `^22.17.0 || >=24.0.0`. |
| UI | Svelte 5.57.2 baseline shared with DLF/DUI. SvelteKit 3.0.1/Vite 8.3.4 pinned and qualified with the Netlify adapter. No `next` dependencies. |
| Workflow | XState 5.33.2; typed owners and leaf SDK/I/O actors. Read the DLF XState memory as integration guidance. |
| Persistence | Jazz `2.0.0-alpha.59` pinned to sibling integration baseline, behind Clipper repository capabilities. DLF granular exports, not its empty root barrel. |
| Shared UI | DUI `0.0.25` radio-group archive from commit `04b3230` is pinned; consume shared controls/theme, including the shell-wide floating Add link button and modal URL form. Do not implement the deferred image viewer. |
| Extraction | Readability 0.6.0 baseline with inert DOM parsing and pre-extraction collection of referenced footnotes; packaged browser-serialized capture worker implemented and tested in Chromium. First-party Node parsing handles raw fetched HTML. Defuddle is a measured alternative, not a simultaneous second pipeline at launch. |
| Localization | i18next 26.7.1 investigated baseline, instance per application runtime with bundled English resources; reactive Svelte adapter; descriptors from workers/machines. No translation-management interface. |
| Search | MiniSearch 7.2.0 pinned and implemented inside a dedicated worker, derived per-account index persisted locally and rebuildable from saved records. No server search. |
| Images | Worker decode/resize/re-encode with locally durable native Jazz byte values; initial policy max 2048 px long edge, quality 0.82 WebP candidate, 2 MiB output target, 20 MiB direct-extension input/40 MP decode ceiling; gateway image responses are capped at 4 MiB for buffered hosting limits. These are provisional technical limits, not validated quality claims. PNG fallback for lossless diagrams/alpha; unavailable images remain explicit rather than silently omitted. |
| Hosting | Netlify adapter with private app rendered client-side, first-party fetch endpoints on Node functions. Verify Kit 3 Vite-based adapter configuration; legacy config is not the target. |
| Validation | Current source/build, native policy and web/offline/Chromium extension suites pass; basic organization runtime is `741844e`, with evidence in the handoff. Broader browser/device and full product acceptance remain open. |
| Performance | Spec SC-001 capture target <30s excluding slow sources; bounded extraction/input limits, initial text before assets, no heavy full-text indexing on UI thread. No library-size throughput SLA is invented. |

## Original planning setup and constitution check (historical)

At the original planning checkpoint, Clipper had no `.specify/` directory. The setup script was attempted and returned missing-file exit 127. No local plan hooks or adopted constitution exist. The sibling plan template was read as a format reference; sibling constitutions are not silently adopted here. Generated paths are resolved manually to this feature directory. This is not a clean automated Spec Kit run.

Preserve these approved boundaries; this historical setup is not a task to restart the implemented foundation:

- Private library: all durable rows/assets enforce server-side owner access, not just UI filtering.
- No second recovery system: consume DLF session/recovery boundaries; request any generic missing bridge there.
- Domain separation: Clipper owns capture/article/annotation logic; DUI owns reusable presentation.
- Local persistence and sync acceptance remain distinct; no saved confirmation from an optimistic value alone.
- Worker/background ownership is explicit, with durable recovery and generation checks on account changes.
- Reduced scope remains intact. No imported legacy behavior or new optional feature is a release requirement.

**Pre/post-design result**: the original design supported the bounded implementation batches now recorded in the handoff. G1–G6 track remaining dependent behavior/release qualification; several capability gates have evidence, without implying full product completion. Formal constitution review is N/A until one is adopted. This staged handoff is not a clean full Speckit gate-completion result.

## Architecture and proposed source structure

Keep extension and app in this repository so domain schemas, source identity and normalization cannot drift. The implemented structure is:

```text
apps/web/                         SvelteKit app, domain/backend contracts, actors, reader and Netlify gateway
apps/extension/                   MV3 background, offscreen runtime, extraction worker, source bar and trusted Options
apps/extension/.test-build/       isolated fixture package; generated and ignored
apps/extension/dist/              unpacked development package; generated and ignored
specs/001-jazz-clipper/            accepted design, checklist and handoff
```

Extension code imports the existing shared source under `apps/web/src/lib`; separate domain/workflow packages have not been created. Do not create empty planned packages or restore the archived prototype/dependencies merely to match an earlier diagram. Browser-specific Firefox packaging remains future work.

The web composition owns its DLF session and account-bound repository. Chromium uses one trusted offscreen document for its DLF/application/library actors and packaged workers. The trusted popup/Options exposes DLF restoration, with a fresh scoped confirmation required before clipping; a restored-account notification drains old-account work before reopening the hidden runtime. Content/page code gets no SDK/account handles or recovery secrets. The MV3 service worker owns gesture admission, Chrome APIs, source-reference markers and IPC validation; it is not expected to keep a WASM client alive itself.

## Runtime ownership

```text
Web layout: DLF session/readiness -> private library -> URL save owner
  dedicated serial article worker -> missing-content resolution/extraction/publication
Chromium background: serialized toolbar launch -> source tab/document validation
  bounded reference + issued marker -> one offscreen runtime -> credential-free page bar
Trusted offscreen runtime: DLF/application/library -> serial clip/save actor -> receipt feedback
  packaged extraction worker; account replacement drains issued work
Trusted Options: DLF recovery/restoration; notify runtime of the selected account
Service worker: public shell/worker/WASM cache; incoming mobile sharing remains unbuilt
Netlify gateway: authenticated, bounded public-source fetch and inert extraction
Search child → native snapshot reader + dedicated index/cache worker
Future owners: annotations, note drafts, images, positions and preferences
```

Actors are attached to the application runtime, not a reader/list component. Each actor defines states, guards, ownership, cancellation and cleanup before async leaf operations are implemented. Every report has account binding, generation and request identity. Account change drains/settles owners, terminates workers, revokes blob URLs, and stops subscriptions; stale A→B→A reports cannot write into the new binding.

Web capture lifecycle: URL article saved → awaiting-session/network → resolving → checking-identity → fetching/capturing → extracting → validating → saving-text → text-ready → acquiring-assets → complete/partial. Existing/trashed matches route to Open/Restore without replacement. Unexpected failures and cancellation produce durable terminal outcomes. Partial captures stay explicitly partial and retry in the same capture/document; automatic retries do not refresh completed snapshots.

Chromium toolbar lifecycle: admit gesture → load confirmed account (or trusted sign-in popup) → verify actual SDK account → validate document → persist bounded reference → show bar → ensure offscreen owner → enqueue clip → extract supplied content (or retain URL only) → mark issued → native save → observe local/remote receipt. Open article is explicit; Close only dismisses the bar. Missing acknowledgements remain uncertain and are not replayed. Source references are not an article database or captured-HTML journal.

## Platform matrix

| Surface | Planned behavior / validation status |
| --- | --- |
| Chrome desktop | Direct MV3 clipping, top bar, offscreen DLF session, packaged CSP/WASM, sender/document checks, restart/sync and Options restoration are qualified in Chromium. Highlighting and store distribution remain open. |
| Firefox on macOS | Extension capture/highlighting with browser-specific background scripts; packaging and lifecycle tests pending. |
| Chrome Android | PWA Add Link plus installed-PWA incoming URL/text share target; real-device/cold-start proof pending. Ordinary desktop extension support is not promised. |
| Safari iOS | PWA Add Link/paste; no inbound share-target promise. Offline storage and restart proof pending. |
| Other mobile extensions/native wrappers | Outside MVP. |

Minimum versions will be set from validated capability/SDK requirements before release, not guessed from desktop APIs.

## Delivery sequence (planning, not tasks.md)

1. Execute the bounded foundation batch: lock the stack/archives, document Clipper agreements, integrate DLF and implement the canonical private root with acceptance checks.
2. Complete the actual domain schema/policies, local durability and native byte-asset acceptance before enabling dependent capture paths.
3. Build a vertical Add Link → saved snapshot → offline restart path with redirect-safe gateway and failure entry.
4. Chromium trusted restoration/direct capture is delivered. Basic library organization follows in PR #14. Firefox packaging and source/reader exact annotation anchoring remain open.
5. Add notes, overlapping highlights, local image acquisition, position restoration and shell caching.
6. Complete tags/Trash, offline search and the retained reader controls after basic status/favorite organization; finish target-device qualification.

## Open implementation gates

The initial [foundation proof](foundation-proof.md) is historical supporting evidence. Actual application integration now includes canonical private roots, native immutable text/byte operations, DLF local-first startup/recovery, authenticated public-only gateway extraction, automatic Add Link saving, routed structured reading and a production offline shell. Current evidence and gaps are in [tasks.md](tasks.md); the handoff identifies the branch/PR and next bounded work.

| Gate | Current evidence and remaining qualification |
| --- | --- |
| G1 Foundation integration | Packaged DLF/public exports, canonical root, owner-only native content policies, account changes, shutdown drain, unknown writes and rejection are exercised in the actual application. Broader domain graphs and future operations require their own policy checks. |
| G2 Extension identity and runtime | Chromium direct clipping now has actual offscreen/account lifecycle, CSP/packaged assets, sender/document validation, non-replay, offline restart and restoration evidence in PR #13. Firefox/store qualification remains open. Content scripts receive no credentials. |
| G3 Fetch gateway authorization and deployment | Existing managed bearer/public verifier, bounded address-pinned redirect-safe transport, Linux native packaging and hosted extraction are qualified. Production gateway enablement is separate; controlled hosted private-redirect qualification remains open. |
| G4 Worker extraction and anchoring | Actual bounded Node parser worker, footnote preservation and shared extraction/display sanitizer are implemented. Static SVG and native disclosures pass extraction, adversarial display and browser tests. Packaged Chromium Readability worker extraction and shared normalized block text are implemented. Source/reader annotation mapping, repeated-quote anchoring and mobile selection remain open. |
| G5 Offline durability and sync | Actual text/native bytes and routed structured HTML (including SVG/disclosures) survive complete Chromium restart with both servers stopped and HTTP cache cleared, then sync to a separately restored profile. URL-first article restart recovery and serial worker processing are implemented; images, full retry scheduling (not a prerequisite to the current clipper review), future draft/annotation operations, quota and deletion/tombstones remain open. |
| G6 Platform qualification | Chromium desktop evidence is recorded. Firefox/macOS extensions, Chrome Android share intake, iOS fallback, accessibility/performance acceptance and minimum supported versions still require actual validation. |

No gate permits silently weakening an accepted requirement. A passed capability does not establish full workflow or MVP completion. The shared content policy supports native `details`/`summary` and static SVG without active/external/reference features; see [design-decisions.md](design-decisions.md#retained-disclosure-and-svg-content). Future sanitizer changes must test both actual extraction and re-sanitization of persisted HTML.

## Complexity and gate recheck

The necessary complexity is cross-origin intake plus local-first ownership, not additional product features. First-party fetching exists because arbitrary PWA reads face CORS; workers exist for responsiveness; local durability receipts and native content availability establish what “saved offline” means. Prefer one repository, one parser baseline, one account preference set and one immutable snapshot. No formal constitution exception is asserted.

See [research.md](research.md), [data-model.md](data-model.md), [contracts/runtime.md](contracts/runtime.md), [contracts/capture-http.md](contracts/capture-http.md), [contracts/platform-intake.md](contracts/platform-intake.md), and [quickstart.md](quickstart.md).
