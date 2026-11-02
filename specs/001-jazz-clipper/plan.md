# Technical Plan: Jazz Clipper and Reader

**Baseline**: `main` (implementation through feature branches/PRs) · **Date**: 2026-11-02 · **Spec**: [spec.md](spec.md)
**Status**: Ready for the first bounded implementation batch described in [implementation-handoff.md](implementation-handoff.md). Full runtime/release qualification remains open; production implementation has not started.

## Summary

The product specification is complete; [design-decisions.md](design-decisions.md) records launch interaction defaults and [specification-review.md](specification-review.md) distinguishes specification completion from runtime qualification. The engineering gates apply before dependent workflows are enabled or released; they do not prevent the bounded foundation implementation that produces their evidence. See the [completed investigation](investigation-results.md).

Replace the legacy Svelte 3/Webnative prototype with a Svelte 5/SvelteKit application and Firefox/Chrome desktop extension sharing typed Clipper domain contracts. Use Delightful Local First (DLF) for session/recovery and Jazz for private, account-scoped durable records and byte-part assets. Store one immutable readable snapshot per successful clip. Extract browser captures locally where feasible and fetch/parse public Add Link sources through a first-party Netlify boundary. Use XState workflows, worker-based search/image processing, conservative W3C-compatible exact anchoring, and a cached PWA shell.

Preserve the approved reduced MVP: no content refresh/revision migration, highlight resizing, bulk operations/broad Undo, device preference overrides, typography presets, image viewer, or reading-time estimation. Named selector/normalization versions do not imply a version-history feature.

## Technical context

| Area | Decision and evidence |
| --- | --- |
| Language/runtime | Strict TypeScript; Node 24 LTS target, pnpm 10.22.0 workspace. DLF/DUI accept Node `^22.17.0 || >=24.0.0`. |
| UI | Svelte 5.57.2 baseline shared with DLF/DUI. SvelteKit 3.0.1/Vite 8.3.x candidate baseline from sibling manifests; verify adapter compatibility and exact lock during setup. No `next` dependencies. |
| Workflow | XState 5.33.2; typed owners and leaf SDK/I/O actors. Read the DLF XState memory as integration guidance. |
| Persistence | Jazz `2.0.0-alpha.59` pinned to sibling integration baseline, behind Clipper repository capabilities. DLF granular exports, not its empty root barrel. |
| Shared UI | DUI `0.0.25` candidate peer baseline; consume existing controls/theme. Do not implement the deferred image viewer. |
| Extraction | Readability 0.6.0 baseline with inert DOM parsing and pre-extraction collection of referenced footnotes; browser-serialized capture worker adapter subject to proof. First-party Node parsing handles raw fetched HTML. Defuddle is a measured alternative, not a simultaneous second pipeline at launch. |
| Localization | i18next 26.7.1 investigated baseline, instance per application runtime with bundled English resources; reactive Svelte adapter; descriptors from workers/machines. No translation-management interface. |
| Search | MiniSearch 7.2.0 investigated baseline inside a dedicated worker, derived per-account index persisted locally and rebuildable from saved records. No server search. |
| Images | Worker decode/resize/re-encode with locally durable byte parts; initial policy max 2048 px long edge, quality 0.82 WebP candidate, 2 MiB output target, 20 MiB direct-extension input/40 MP decode ceiling; gateway image responses are capped at 4 MiB for buffered hosting limits. These are provisional technical limits, not validated quality claims. PNG fallback for lossless diagrams/alpha; unavailable images remain explicit rather than silently omitted. |
| Hosting | Netlify adapter with private app rendered client-side, first-party fetch endpoints on Node functions. Verify Kit 3 Vite-based adapter configuration; legacy config is not the target. |
| Validation | Later: type/lint, contract/unit tests at actor boundaries, browser/extension and real-device scenarios. This turn runs no implementation tests. |
| Performance | Spec SC-001 capture target <30s excluding slow sources; bounded extraction/input limits, initial text before assets, no heavy full-text indexing on UI thread. No library-size throughput SLA is invented. |

## Setup and constitution check

Clipper has no `.specify/` directory. The required setup script was attempted and returned missing-file exit 127. No local plan hooks or adopted constitution exist. The sibling plan template was read as a format reference; sibling constitutions are not silently adopted here. Generated paths are resolved manually to this feature directory. This is not a clean automated Spec Kit run.

Use approved spec constraints as the provisional design checklist:

- Private library: all durable rows/assets enforce server-side owner access, not just UI filtering.
- No second recovery system: consume DLF session/recovery boundaries; request any generic missing bridge there.
- Domain separation: Clipper owns capture/article/annotation logic; DUI owns reusable presentation.
- Local persistence and sync acceptance remain distinct; no saved confirmation from an optimistic value alone.
- Worker/background ownership is explicit, with durable recovery and generation checks on account changes.
- Reduced scope remains intact. No imported legacy behavior or new optional feature is a release requirement.

**Pre/post-design result**: product/design boundaries support the first bounded foundation implementation. G1–G6 remain acceptance gates before dependent production behavior/release, not a claim of finished validation. Formal constitution review is N/A until one is adopted. This staged handoff is not a clean full Speckit gate-completion result.

## Architecture and proposed source structure

Keep extension and app in this repository so source identity, selectors, messages, and schemas cannot drift between repos. Proposed workspace:

```text
apps/web/                         SvelteKit routes, browser integration, Netlify endpoints
apps/extension/                   target manifests, content scripts, background journal, trusted UI
packages/clipper-domain/           types, normalization, validation, repository contracts
packages/clipper-workflows/        XState owners, capture/assets/notes/search/navigation
packages/clipper-workers/          extraction, image processing, search protocols
packages/clipper-localization/     i18next English resources and descriptors
specs/001-jazz-clipper/             current design artifacts
```

These paths are planned, not created. The previous prototype, Webnative/PDF/EPUB dependencies and service worker are preserved on the archive branch; the spec-only `main` baseline contains none of them. Implementation starts clean, with no user-data migration. Use explicit Vite extension builds with a shared source set and browser-specific manifests; do not assume Chrome's service-worker lifecycle equals Firefox's background runtime.

The web browser composition owns one DLF session and one account-bound repository. The extension's trusted UI has its own DLF session restored to the same account; its background journal and messages are account/generation-scoped. Content scripts receive only capture/selector data and sanitized annotation views, never account handles or recovery secrets. A sleeping extension background is not assumed to keep a Jazz WASM client alive.

## Runtime ownership

```text
Browser composition (web or trusted extension UI)
  DLF session owner/readiness -> private-library binding
  library runtime
    capture owners (one per durable capture attempt)
    asset owners (bounded concurrency)
    annotation and note-edit owners
    search worker/index owner
    reading-position owner
    account preference owner
Service worker: shell cache, share intake journal, wake notifications only
Extension background: bounded privileged fetch, intake journal, message validation
Netlify gateway: authenticated, bounded public-source fetch and inert extraction
```

Actors are attached to the application runtime, not a reader/list component. Each actor defines states, guards, ownership, cancellation and cleanup before async leaf operations are implemented. Every report has account binding, generation and request identity. Account change drains/settles owners, terminates workers, revokes blob URLs, and stops subscriptions; stale A→B→A reports cannot write into the new binding.

Capture lifecycle: journaled → awaiting-session/network → resolving → checking-identity → fetching/capturing → extracting → validating → saving-text → text-ready → acquiring-assets → complete/partial. Existing/trashed matches route to Open/Restore without replacement. Unexpected failures and cancellation produce durable terminal outcomes. Partial captures stay explicitly partial and retry in the same capture/document; automatic retries do not refresh completed snapshots.

## Platform matrix

| Surface | Planned behavior / validation status |
| --- | --- |
| Chrome desktop | Extension capture/highlighting with MV3 background journal; package/CSP/session tests pending. |
| Firefox on macOS | Extension capture/highlighting with browser-specific background scripts; packaging and lifecycle tests pending. |
| Chrome Android | PWA Add Link plus installed-PWA incoming URL/text share target; real-device/cold-start proof pending. Ordinary desktop extension support is not promised. |
| Safari iOS | PWA Add Link/paste; no inbound share-target promise. Offline storage and restart proof pending. |
| Other mobile extensions/native wrappers | Outside MVP. |

Minimum versions will be set from validated capability/SDK requirements before release, not guessed from desktop APIs.

## Delivery sequence (planning, not tasks.md)

1. Execute the bounded foundation batch: lock the stack/archives, document Clipper agreements, integrate DLF and implement the canonical private root with acceptance checks.
2. Complete the actual domain schema/policies, local durability and blob-part acceptance before enabling dependent capture paths.
3. Build a vertical Add Link → saved snapshot → offline restart path with redirect-safe gateway and failure entry.
4. Add trusted extension same-account restoration and browser capture; prove source/reader exact anchoring.
5. Add notes, overlapping highlights, local image acquisition, position restoration and shell caching.
6. Add organization/Trash, offline search and the retained reader controls; finish target-device qualification.

## Open implementation gates

The first [foundation proof](foundation-proof.md) passed five isolated local-authority scenario groups: exclusive creation, private row/byte reads, rejected ownership/reference attacks, atomic rejection and precommit rollback. This is partial G1 evidence, not DLF/browser/cold-restart qualification. The production application remains unimplemented.

The [selected library bootstrap](contracts/library-bootstrap.md) supersedes the earlier generic-creation dependency: Clipper ensures one canonical immutable account-ID root through its app-owned data boundary. Packaged DLF identity/recovery is exercised; generic multi-workspace creation remains separate foundation work. Independent offline replica and full domain-policy qualification remain G1 acceptance.

| Gate | Evidence needed before dependent implementation/release |
| --- | --- |
| G1 Foundation integration | Exact DLF archive/public exports exercised; local authority owner/root checks passed. Implement production canonical root/domain graph and qualify two independent offline replicas, Node 24 and complete policy/deployment behavior. |
| G2 Extension identity and runtime | Packaged DLF restored the same synthetic account in Chromium MV3 with local WASM; local rows/bytes survived page close. Qualify actual intake/background lifecycle and Firefox; content scripts receive no credentials. Automatic device linking is unnecessary. |
| G3 Fetch gateway authorization and deployment | Managed current-bearer/public SDK verifier matched the browser account and rejected tampering locally. Implement fixed-origin request leaf, Linux Netlify native packaging, operation authorization and pinned public-only redirect-safe transport before enabling gateway. |
| G4 Worker extraction and anchoring | Synthetic serialized DOM/Node-worker extraction parity supports baseline; footnote target loss requires precollection. Qualify actual browser worker, final sanitized mapping, repeated quotes, Unicode and mobile selection on representative fixtures. |
| G5 Offline durability and sync | Local rows/bytes survived browser and extension page close with authority stopped. Qualify offline shell/full process restart, second-device transfer, actual images, partial writes/quota and deletion/tombstones. |
| G6 Platform qualification | Real Firefox/macOS and Chrome desktop extension tests; Chrome Android PWA share intake and iOS Add Link fallback; minimum versions recorded from actual validation. |

No gate permits silently weakening an accepted requirement. If a gate fails, revise the plan or obtain a scoped decision. Qualification remains open; the first batch is ready to build the necessary production artifacts. The full skill's no-unresolved-gates completion criterion is not claimed.

## Complexity and gate recheck

The necessary complexity is cross-origin intake plus local-first ownership, not additional product features. First-party fetching exists because arbitrary PWA reads face CORS; workers exist for responsiveness; byte-part staging exists because “saved offline” must describe actual durable bytes. Prefer one repository, one parser baseline, one account preference set and one immutable snapshot. No formal constitution exception is asserted.

See [research.md](research.md), [data-model.md](data-model.md), [contracts/runtime.md](contracts/runtime.md), [contracts/capture-http.md](contracts/capture-http.md), [contracts/platform-intake.md](contracts/platform-intake.md), and [quickstart.md](quickstart.md).
