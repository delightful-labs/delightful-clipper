# MVP specification completion review

**Original review**: 2026-11-02 · **Implementation pointer updated**: 2026-11-04
**Result**: Product specification complete for the approved reduced scope. The subsequent investigation and implementation have delivered the foundation, web capture/reader/offline shell and Chromium direct clipper. The [handoff](implementation-handoff.md) and [tasks](tasks.md) are authoritative for current evidence; this original review is not a live completion checklist. Full runtime/release qualification is not complete.

## Requirement disposition

All functional IDs in spec.md are retained for traceability. A deferred ID may contain a launch safety requirement (for example, honest ambiguous-anchor status) without pulling its deferred repair interface into MVP.

| Requirements | Disposition / design coverage |
| --- | --- |
| FR-001–005 | Capture, offline text/images, TOC and footnotes: plan, capture/platform contracts, data model; extractor/asset fixture proof remains. |
| FR-006–010 | Annotation identity, desktop extension, shared account, Add Link and supported share intake: runtime/platform contracts and data model. |
| FR-011–017 | Localization, reader controls, workflow/background ownership, DLF identity, Netlify and no legacy migration: plan and design decisions. |
| FR-018 | Duplicate capture preserves existing snapshot/status/progress: URL/capture contracts and design decisions. |
| FR-019–023 | Refresh/revision/repair interfaces deferred. Preserve original anchors, quotes and honest ambiguity/unresolved status at launch. |
| FR-024–025, FR-025a | Distinct tag assignments, offline typed search and explicit Trash scope: runtime contract and design decisions. |
| FR-026–030 | Status/favorites, Trash/Restore, explicit highlights and future color metadata: data model and design decisions. |
| FR-031 | Highlight resizing deferred. |
| FR-032–038 | Independent overlaps, highlight Undo, one plain-text autosaved note, theme/preferences and filters: runtime/data contracts and design decisions. |
| FR-039 | Bulk actions deferred. |
| FR-040–046 | Private owner library, local/synced positions, explicit archive, progress, distraction-free mode and continuous scroll: bootstrap/data/runtime contracts and design decisions. |
| FR-047 | DUI image viewer deferred; inline saved images remain. |
| FR-048–051 | Browser link behavior, tag-filtered views and global tag administration: runtime/data contracts and design decisions. FR-049 broad Undo deferred. |
| FR-052–058 | Entry-point confirmations, link-only Retry, single URL intake, runtime-owned continuation, bounded retries and image processing: capture/platform/runtime contracts, plan and design decisions. |
| FR-059–061 | Newest-original-save list, safe partial capture and localizable English: data model and design decisions. |

SC-001–011 define eventual full-product acceptance. No tests were executed during the original specification review; implemented subsets now have evidence recorded in tasks.md. The quickstart distinguishes current checks from future acceptance. Source review, link checks and requirement coverage are documentation checks only.

## Scope and consistency review

- No content-refresh/history/repair UI, resizing, bulk actions, broad Undo, per-device overrides, named presets, image viewer or reading-time feature added.
- One highlight color retains extensible metadata. One logical plain-text note per parent retains text on conflicts/failure; recovery is required behavior, not a new dashboard.
- Article/highlight tags remain independent; note hits follow their immediate parent's tags, with status/favorite inherited from the document. Trash is excluded by default.
- Saved text and assets require local durability; pending intake, pending images, local save and remote acceptance have distinct outcomes.
- URL redirects/shorteners are observed and revalidated. Canonical declarations do not alone merge articles. Retry/duplicate reconciliation preserves user work.
- Browser assumptions are reconciled: desktop extensions, supported Android PWA intake, iOS Add Link fallback; no promise of Chrome Android extensions or unsupported iOS incoming sharing.
- Named system-font controls and other interaction defaults are reversible design choices within existing scope; visual styling is not frozen.
- Same-account extension restoration uses DLF; no separate recovery/credential-export system. DLF owns reusable creation lifecycle; Clipper owns domain schema/policies; DUI owns generic presentation.

## Engineering handoff and limits

G1–G6 in plan.md remain explicit qualification gates. They are not unanswered feature-selection questions. Missing runtime evidence cannot be fabricated by further prose:

1. Foundation private creation/package/schema/policy and uncertain-commit recovery.
2. Packaged extension account restoration, CSP/WASM and durable storage.
3. Authenticated first-party fetching: trusted-client proof acquisition, public SDK verifier/native deployment, actual public-only network transport.
4. Extraction/normalization/selector fixtures and accessible original-page/reader annotation behavior.
5. Real offline restart, assets, synchronization, account isolation and deletion handling.
6. Desktop and mobile platform qualification with recorded minimum versions.

The bounded foundation experiments are recorded in foundation-proof.md and investigation-results.md. Those foundation/Add Link/reader/offline batches are now implemented, followed by Chromium direct clipping in PR #13. Next is user review and selection of a bounded follow-up, not restarting the foundation or implementing the full backlog automatically. This document authorizes neither implementation nor deployment; it does not satisfy the Speckit planning workflow's unresolved-gate completion criterion. Product scope is settled; revise technical choices within that scope as evidence arrives. Request product input only if evidence requires changing accepted behavior.
