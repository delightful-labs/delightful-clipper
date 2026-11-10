# MVP design decisions and acceptance details

**AT Protocol status (2026-11-10):** [Merged implementation, accepted publication decisions and remaining work](atproto.md). This checkpoint supersedes historical JWT/Neon, alpha.59 and Netlify-only AT Protocol notes below; it does not mark annotation/publication requirements implemented.

**Updated**: 2026-11-05. Accepted interaction decisions and remaining product design. Implemented evidence is tracked in [tasks.md](tasks.md); unbuilt controls below remain requirements, not completion claims. The product spec governs any conflict.

## Reader, navigation and accessibility

The library is `/`; saved articles use dedicated SvelteKit `/articles/[id]` pages with normal same-tab links. Direct URLs, reload, browser Back/Forward and normal new-tab actions must work. The layout owns account/library/capture lifetimes so route navigation cannot discard pending captures; reader departure cancels reads and clears visible content. Owner-scoped article data is loaded from the existing local-first client runtime, never embedded in public server/prerender output. Offline reader navigation may reuse the public app shell, without caching private route responses.

Use locally available system serif and system sans-serif stacks as the two launch font choices. No remote font download, font upload or preset manager. Initial controls: font size 16–32 CSS px (20 default), line height 1.3–2.0 (1.6 default), and maximum text width 40–90ch (65ch default), constrained to the available viewport. Browser zoom and user stylesheet overrides remain functional; these control ranges are not limits on browser magnification. Shared account preferences retain offline cached values.

Distraction-free mode has a persistent, focusable Show controls/Exit control usable by touch and keyboard. Focus within a control prevents it from hiding. Do not depend on hover, pointer movement, color alone or an undiscoverable gesture. Escape closes the topmost transient popover first; it does not discard a note draft. After closing a popover, return focus to its trigger when it still exists, otherwise to the corresponding article/annotation heading.

Archive leaves the current reader open and updates status; no automatic next article. Moving the open article to Trash returns to the originating list and focuses the next surviving item, previous item, or list heading in that order. Permanent deletion also returns to that list. Inline images do not open a viewer in MVP. Source/article links retain browser behavior.

Each highlight has a focusable entry in the annotation collection. Activating a region containing several highlights offers a labeled list of the separate annotations rather than arbitrarily choosing one. Touch and keyboard can reach the same list. It is an annotation-access control, not a merge or repair screen. Rendering must preserve readable text contrast in Light/Dark/System, selection, copy, focus indicators and overlapping-range access.

Acceptance includes keyboard-only capture/reader/note/tag workflows, accessible names and save-status announcements, touch selection with explicit Highlight, zoom/reflow without lost controls, reduced motion, meaningful image alternative text, and restoring focus after dialogs. No compliance certification is claimed from a design document.

## Notes, conflicts and persistence

### Accepted Margin public representation — 2026-11-07

The user approved Margin's combined public representation: a quotation and its attached note are presented together as one `at.margin.note` annotation. Clipper retains independent local highlight and note identities and their explicit relationships; the public projection does not replace those entities. A separate public reply is not required for the author's attached note in this slice. See [the concrete examples](../../docs/atproto-research.md#shared-public-content).

This acceptance selects the combined representation, not an exact payload, mapping schema, key algorithm, extension mechanism or publication process. Jazz originals and explicitly confirmed initial publication remain the baseline. No implementation or deployment is authorized by this representation decision alone.

### Accepted ongoing publication synchronization — 2026-11-07

The user subsequently selected ongoing Jazz-to-AT synchronization for published items: changes in Jazz propagate to their AT Protocol copy without a separate confirmation for each update; deleting a published item in Jazz sends a deletion request for its AT copy. This supersedes the earlier snapshot-only/explicit-republish rule. Unpublished items remain unpublished until initial publication is explicitly confirmed. Jazz remains the source authority; inbound edits from AT are not selected by this direction.

Local work remains usable offline. Jazz persistence, pending AT synchronization, accepted updates/deletion requests and unknown outcomes remain distinct; requesting deletion does not establish erasure from all downstream copies. The user approved waiting for Jazz server acceptance of the relevant source change before sending it to AT Protocol. Local persistence alone does not admit public writes; offline changes wait without blocking editing. Exact acceptance evidence, retry/recovery ownership and request mechanics still require design review. No data shape, queue, executor or retry process is selected here.

The user clarified the combined record's note-only deletion behavior: when the attached note is deleted but the highlight remains, update the existing public annotation to a bare highlight. Retain its public identity and quotation; remove the deleted note's commentary. This is an update, not deletion and recreation of the public record. Deleting the published highlight itself remains subject to the AT deletion-request requirement. Other constituent relationships and exact payload mapping remain for review.

The user approved automatic publication of a newly attached note on an already-public bare highlight: saving that note updates the existing public annotation to include its commentary without a separate first-note confirmation. This extends the selected highlight's ongoing synchronization; unrelated notes/highlights remain unpublished. Unresolved conflicts and external-deletion pauses still block automatic public writes. Exact payload mapping and public-status presentation remain for review.

The user selected keeping Clipper's organizational tags private for the initial integration. Do not automatically include library, article or annotation organizational tags in public Margin records or their updates. Using Margin's shared annotation vocabulary does not require populating its optional tags. Creating/editing public tags in Clipper is not selected by this decision.

The user approved preserving non-content metadata added by another app, such as public tags, and continuing synchronization when the quotation and note are unchanged. Do not copy those public tags into Clipper's private organizational tags or erase them on the next outgoing update. This is an exception to pausing for external content edits, not permission to classify every unknown field as harmless. Exact content/metadata comparison and preservation mechanics remain for the technical review.

The user approved including short excerpts immediately before and after the selected quotation in public highlights to help other apps locate the intended passage. Show that surrounding text in the publication preview as part of the public content. Each side must fit both 150 Unicode grapheme clusters and 500 UTF-8 bytes, retaining the nearest available text without cutting a character/grapheme. This approves source-text context, not disclosure of private notes, organizational tags or the full saved article. Exact extraction/versioning and payload mapping still require review; no new localized copy is selected.

The user approved exact note-text caps matching the inspected Margin body: at most 3,000 Unicode grapheme clusters and at most 10,000 UTF-8 bytes; both constraints apply. This concerns article-level and highlight-attached notes, not saved article text or the separately bounded highlight quotation. UTF-16 code-unit length is not a substitute for either count. For an oversized paste, preserve the full text in a recoverable draft, explain the limit and require shortening before saving the note. Never silently cut the pasted text. Exact interaction/copy, existing-content handling and oversized external imports remain for review; no migration is authorized.

The user approved separate limits for new highlight quotations: at most 1,500 Unicode grapheme clusters and at most 5,000 UTF-8 bytes, with both constraints applying. This bounds the selected passage rather than the saved article and does not authorize silently truncating or splitting a quotation. Existing retained highlights and oversized imported records are not implicitly migrated or discarded. Exact enforcement interactions remain for review.

The user selected pause-and-resolve behavior when another application edits the public annotation: pause its automatic synchronization and ask the user to resolve the difference. Do not automatically overwrite the external edit from Jazz, silently import it into Jazz, or merge it without review. Preserve both versions needed for resolution. A later sync attempt must not bypass an unresolved conflict merely because newer Jazz edits exist. [The proposed sync state model](../../docs/reviews/margin-sync-technical-proposal.md) is a review draft, not an accepted process or implementation.

The user approved comparing the Clipper and public versions side by side with three resolution choices: use Clipper's version to update the public annotation; use the public version to explicitly apply it to Clipper; or leave synchronization paused while preserving both. The second choice is a user-requested import, not automatic bidirectional synchronization. The choice must apply to the versions reviewed, not silently substitute a newer local or public edit. Exact comparison, public-to-local field mapping and controls/localization remain for review; no implementation or payload is selected.

The user also approved external-deletion behavior: when the public annotation is deleted in another app, retain the local highlight and note, pause synchronization, and show that the public copy was deleted. Recreating it requires an explicit user choice. Later Jazz edits, reconnect, retry and restart must not automatically recreate it. A failed or unavailable remote lookup is not proof of deletion; distinguish a confirmed external deletion from our own accepted deletion or an uncertain outcome. Exact recreation mechanics and persistence remain for review.

The user selected public deletion on Trash: moving a published item to Trash sends a deletion request for its AT copy rather than waiting for permanent deletion. The local item remains recoverable under existing Trash behavior. The user subsequently approved automatic republication when restoring a previously published item from Trash; restoring an unpublished item leaves it unpublished. Restore reverses Clipper's own Trash action and does not bypass unresolved external-edit or external-deletion pauses. Restore reuses the original public record address so links to that annotation can work again; it does not require the restored content to have the same version CID. This does not authorize overwriting an external conflict or switching the destination identity. Exact handling of an in-flight or uncertain deletion and synchronization mechanics still require design review.

The user approved deliberate unpublishing without local deletion: request deletion of the public copy, retain the item in Clipper, and stop subsequent public synchronization until the user explicitly publishes it again. Later Jazz edits stay local. Unpublishing does not report public deletion as accepted before confirmation and does not abandon an issued or uncertain request. This differs from temporary Trash removal: restoring from Trash must not undo an explicit unpublish decision. Exact persistence and request ordering remain for review.

The user approved latest-version behavior before first publication: when Publish is chosen offline and the selected item is edited before uploading, publish its latest saved version when connectivity permits and Jazz server acceptance has been established. The choice follows the selected item rather than freezing the preview's older revision. Destination changes, revoked publication choice and conflict/deletion pauses are not authorized by this rule. Once a request has been issued, its source version remains fixed for settlement; later changes remain subsequent work. Exact acceptance evidence and capture mechanics still require review.

The user clarified on 2026-11-06 that notes and highlights are intended to work with AT Protocol, an omitted requirement from the original planning. Model both as independent entities with their own stable IDs and explicit article links. Notes attached to highlights also have an explicit highlight link. "One note per parent" controls cardinality; it does not eliminate the independent note record. Any retained revision history references the note's identity. DLF owns shared AT Protocol integration across apps and is starting with identity. Preserve independent domain IDs and explicit relationships now; do not require a publication/source-of-truth decision or implement a Clipper-specific AT identity system for this phase. See [data-model.md](data-model.md#at-protocol-identity-boundary). Current article-keyed revision/draft groundwork is not the final entity architecture.

Persist a device-local draft on each edit through the draft owner; debounce source-of-truth note writes by 500 ms and flush when leaving the editor. Keep the current edit sequence so a delayed acknowledgment cannot label newer text saved. Navigation can proceed once the recoverable draft is durable. If neither draft nor note persistence succeeds, warn before navigation instead of reporting Saved.

Display Saving locally, Saved on this device / Sync pending, Synced, or Save failed as applicable. Connectivity does not gate local editing. A locally durable note may still receive a later remote rejection; retain its text and expose recovery status. Clearing a note saves empty content; an empty note does not create another note or remove its highlight.

Keep one logical note per parent. Concurrent user text must be merged without lost edits where the supported text primitive permits it; otherwise retain both versions in a recoverable conflict and offer a minimal choice/copy action within the note editor. Never silently overwrite a divergent draft, concatenate blindly, or introduce a separate conflict-management dashboard. Concrete storage semantics require qualification.

For independent scalar fields (status, favorite and each preference), use causal ordering when available and deterministic operation-ID tie-breaking for concurrent values. Store desired values rather than replaying toggles. Changes to one field do not overwrite another. Tag assignments are distinct relationships; global tag tombstones suppress stale assignments. Concurrent edits of the same tag name remain recoverable on collision. Delete/restore operations inspect the parent lifecycle before writing.

## Search and tags

Plain case-insensitive keyword search, all entered terms required, with labeled article/highlight/note hits and no query language. Index article title/body, saved quote and literal note text. Use the search engine's default relevance with title boosts and stable original-save-date/ID tie-breaks. The user subsequently requested fuzzy matching for close spellings such as continue/continues. Article search uses MiniSearch's bounded 20% edit tolerance (maximum two edits) for terms of at least four characters; shorter terms remain exact. Advanced ranking controls remain out of scope.

Status, favorites and selected tags combine with AND; multiple selected tags also require all selected tags on the explicit result target. Note results use the note parent's tag assignments. Status/favorite always use the parent article. Activating a tag lists explicitly tagged articles/highlights; it does not infer inheritance. Trash is a separate explicit scope, with the same locally available text/filter semantics.

Tag keys use trimmed Unicode NFC text plus versioned Unicode default case folding, preserving the user's display spelling. Reject an empty key. Do not strip accents or punctuation. Same normalized key reuses the existing tag; rename collisions report a conflict without implicit merge. Duplicate keys produced concurrently must reconcile assignments without deleting content; the storage policy remains a proof gate.

## Positions and progress

Save the first visible reading text position using its representation, normalized code-point position and quote/context, with viewport offset as a secondary aid. Debounce updates by one second and flush on reader departure where the runtime permits; do not rely only on unload. Opening waits for the local saved representation and applies the latest available position once. Later remote updates never scroll an open article.

Per-device observations use causal knowledge, interaction time and deterministic operation ID to resolve available positions; device clock skew is a known limitation, not a claim of globally exact wall-clock ordering. An unsynced local observation is not discarded just because a remote value arrived later.

Display progress as the furthest observed reading position divided by the saved representation's readable text length, clamped to 0–100%; end-of-content reaches 100%. This measures position reached, not verified comprehension, reading time or a separate completed state. Last location may move backward while progress remains furthest reached. Zero-length/link-only entries have no percentage. Restore by verified locator/context first; if no reliable match exists, open at the beginning without overwriting the saved evidence until a new user interaction.

## Highlight deletion and article deletion

Highlight-delete Undo restores the same annotation, anchors, note and assignments. Offer it for at least ten seconds; keep it available while its control is focused/hovered, pause expiry while the page is hidden, and provide an accessibility timing qualification before release. Do not announce an Undo that already expired. Parent permanent deletion or loss of permission prevents restoration with a clear outcome. No other broad Undo is added.

Permanent article deletion first persists a dominating document tombstone, then cleans content/annotations/notes/assignments/positions and unreferenced asset rows/index entries through resumable idempotent work. Shared tag vocabulary survives. Retained byte assets are reference-checked within the owner scope. A stale offline edit cannot silently resurrect a permanently deleted graph; retain recoverable draft evidence without restoring the article. No guarantee about erasing previously downloaded copies or provider backups is implied.

## Capture, URLs and images

Normalize URL syntax conservatively: parsed HTTP(S), lowercase scheme/host and default-port normalization; retain query order/values, meaningful path segments and submitted fragments as provenance. Do not blanket-strip tracking parameters, upgrade HTTP to HTTPS, remove trailing slashes or equate www/non-www. A fragment does not create a second saved article when the same fetched representation is established, but is retained as an intake locator.

Dedup first by verified final destination/accepted alias. A declared canonical is a candidate only: if it differs, fetch/observe its destination under the same safety rules and require equivalent normalized article content before accepting the alias. Cross-origin candidates require the same evidence; inability to verify leaves the candidate unaccepted. Shortener URLs are observations with time/destination, not permanent aliases. Concurrent reconciliation preserves annotations and provenance before retiring provisional duplicates.

Use the image limits in plan.md as initial processing defaults. Never upscale. Preserve source aspect ratio and alt text; use a lossless output for diagrams/transparency when it fits. Reduce dimensions/quality within the bounded worker policy; if no usable output meets limits, retain a labeled unavailable asset with Retry rather than blocking text or claiming full offline completeness. Animated images may use a static first frame with that limitation indicated. No image-quality guarantee is inferred before fixture review.

Connectivity retry uses capped exponential backoff with jitter, at most five automatic attempts per wake/connectivity cycle, maximum delay five minutes; permanent input/authorization/unsupported-source failures require corrective action. Retain durable work when exhausted. Resuming a runtime does not replay an uncertain insert; reconcile operation IDs first. Incomplete capture detection uses explicit parser/source evidence and missing required content signals; do not invent a universal completeness score.

## Engineering dependencies, not additional product questions

Supported desktop extension runtimes are Chrome and Firefox; Android Chrome uses supported installed-PWA sharing with Add Link fallback; iOS Safari uses Add Link until incoming share support is demonstrated. Minimum release versions are recorded after real-device qualification, not guessed here. First-time identity/library setup and recovery must preserve DLF's provenance rules; no unsupported promise of offline first-ever provisioning is made.

One repository, Readability baseline, i18next runtime instances, Jazz alpha.60, DLF granular boundaries and worker ownership are selected in plan.md. Extension restoration uses DLF in trusted extension UI, not automatic web-origin SSO. Missing creation, request-auth proof acquisition, packaged extension persistence, public-only fetch transport and cold-restart evidence remain explicit implementation gates. Failure of a gate requires revising the plan or a scoped product decision, not adding a fallback account system or silently weakening offline/private behavior.

Storage simplification accepted for PR #5: use native Jazz text/byte columns and atomic publication instead of custom gzip/manifests/parts/checksums. Keep domain input bounds, operation fingerprints, private parent policies and separate local/remote receipts. Do not introduce another storage protocol without a demonstrated SDK limitation.

### Retained disclosure and SVG content

Extraction and display share a DOMPurify factory and namespace-specific attribute policy. Native `details`/`summary` retain `open` and browser keyboard behavior; grouping names are removed. Inline SVG retains static shapes, paths, groups, text, title/description, geometry and solid paints. SVG IDs, links/references (including local paint references), CSS, images, embedded HTML, filters and animation are stripped. Gradients and reusable `use` definitions are not supported by this initial subset. The reader constrains SVG width to its content area. Existing article byte/node limits apply, with a 16 KiB per SVG attribute bound. This policy is applied again to persisted HTML rather than trusting extraction alone.

## URL-first article saving

Add Link immediately saves the article with its URL. The same save operation optionally accepts content from a browser clipper. A dedicated module-worker XState machine processes articles missing content serially, retaining the same object on failure and Retry. Main-thread code owns only trusted SDK/network leaves and resource draining. No separate intake graph or custom IndexedDB journal is used. See [durable-capture-design.md](durable-capture-design.md) for publication barriers and current evidence limits.


## Direct browser clipping and current batch boundary

The user selected a sign-in gate for extension clipping: unconnected clicks open a trusted popup; connected clicks continue with direct saving from the toolbar, with a bar at the top of the source page rather than a new confirmation tab. The bar displays owning-machine status, Open article and Close. Close hides presentation; it never cancels or deletes native data, and late progress cannot recreate the dismissed bar. Do not restore the old Save confirmation workflow or copy the unrelated highlighting/tagging controls from the Readwise reference image into this batch.

Chromium uses one trusted offscreen document for DLF identity, the library/save actors and packaged workers. Background states validate the toolbar tab/document, persist bounded source references, mark issued writes and validate IPC senders. Source-page code receives literal feedback and safe links only. Sign-in/restoration uses the trusted popup or Options; restoring an account drains issued old-account work before reopening the runtime. There is no automatic web-origin SSO, captured-HTML journal, automatic replay of issued references or second article database.

The delivered batch is ready for user review, not a claim of full product completion. Full backoff scheduling and the future generic DLF machine-observer export are not prerequisites to using/reviewing this batch. Retain them as future work where applicable. No next feature is authorized merely because it appears in the backlog. See the handoff for the current PR and platform evidence.


### Confirmed extension connection

The later user correction requires sign-in before clipping, rather than silently saving into an unrelated extension-local identity. The web app still starts local-first without signup. Extension sign-in uses existing DLF recovery/restoration, not a new credential system or web-origin SSO. Existing stored identities are not automatically grandfathered as connected.

Only a completed restoration can persist a nonsecret confirmation (account ID, Jazz app/server and a fresh confirmation ID). Persist it before notifying the hidden runtime. Toolbar states load that confirmation, verify the runtime’s actual account and only then inspect/capture/save the original source. Closing the popup without a fresh confirmation returns without saving. Confirmation alone is not authorization: a stale account/server scope must still fail native account admission. Source content and credentials never enter the same message boundary.

## Basic organization batch

PR #13 is merged and the user verified extension sign-in and saving into the web library. The next authorized batch is Inbox/Later/Archive plus independent favorites, status views with an AND favorites filter, native synchronization and offline restart. Existing articles default to Inbox/unfavorited; organization never changes original save order. The implementation state/ownership design is in [library-organization.md](library-organization.md). Tags, Trash, search, images, annotations and bulk actions remain excluded from this batch. PR #14 implements this bounded batch; the handoff records actual source/browser/offline evidence. Broader product and platform acceptance remains open.

## Readable state names for workflow feedback

Use localized `meta.name` and severity on owning states. Explicit states, guards and transitions select reader, capture, organization, offline and account outcomes. Parallel regions use message channels so account feedback or reader feedback cannot displace another workflow's status. Selectors project metadata; they do not reconstruct workflow outcomes from flags or translate status codes. A worker may forward an already-localized message from its owning machine. Persisted error/receipt codes remain domain data and retain their existing storage representation.


## Offline image implementation boundary

The current batch implements a serial library-owned image queue, private native byte assets and inline DUI-based placeholders/Retry. Worker processing accepts PNG/JPEG/WebP/GIF headers within 4 MiB gateway input and 40 MP, scales without upsampling to a 2048 px long edge, and caps outputs at 2 MiB using PNG for PNG sources and WebP 0.82 otherwise. Size failures trigger bounded dimension reduction; GIF becomes a static frame. HTTP Retry-After is respected up to five minutes. Unknown writes remain blocked in the active owner; restart acquisition first checks the persisted native operation identity, and publication checks it again within the transaction. Existing marker-free snapshots are unchanged; authenticated/data/SVG/AVIF sources and the viewer remain outside this batch. See offline-images.md for validation and limitations. No additional package or catalog wording is required; current placeholders reuse DUI LoadingSpinner and approved Get-image, Retry and generic failure/unknown-save templates.

## Accepted companion fields and grouped synchronization — 2026-11-07

The user approved the candidate fields and grouped synchronization approach in the [Clipper companion proposal](../../docs/reviews/clipper-companion-lexicon-proposal.md): Margin retains shared quotation/commentary; separately addressable highlight and note companions carry required `subject` (Margin URI and CID) and public `article` URI, with optional highlight-to-note `note` and note-to-highlight `highlight` relationships. Private Jazz identities and organizational data remain private. Attached note identity remains independent of highlight identity and revisions.

The approved approach groups common/companion changes in conditional repository batches, with durable group attempt evidence, recovery before retry, and verification of stale observations rather than automatic repair. A companion conflict pauses the entire outgoing group. The actual namespace remains unselected. Specific key/discovery conventions, external-deletion cleanup, backfill, credential upgrade and release-dependent implementation APIs are not selected by this approval. No implementation, schema publication, dependency installation, migration or deployment is authorized by this decision alone.

### AT Protocol native Jazz direction — 2026-11-09

After the alpha.60/Vercel update, the user selected Jazz's native account following
and requested removing Neon. Better Auth uses Jazz's bundled adapter and the
existing backend store. The default SDK guest linking, existing-user sign-in and
remembered-account persistence replace the manual JWT source, Clipper selection
record and separate connect/sign-in account operations in the earlier proof.
Those earlier workflow/storage notes are historical and are superseded here.

Clipper retains its worker-owned provider redirect and callback feedback, drains
before navigation and clears the provider cookie before native logout. Generated
Jazz migrations add private backend-only auth tables without resetting existing
libraries. No publication/lexicon work is implemented in this update. See
[the native auth review](../../docs/reviews/atproto-native-alpha60.md).
