# Feature Specification: Jazz Clipper and Reader

**Baseline**: `main` — subsequent implementation uses feature branches and PRs
**Created**: 2026-11-02
**Updated**: 2026-11-05
**Status**: Accepted product requirements with partial implementation. Local-first storage, URL-first Add Link, the saved reader/offline shell and Chromium direct browser clipping are implemented. Basic library organization is merged in PR #14 at `5e3c5c6`; DUI radio filters and compact list presentation are merged in PR #15 at `72b6fc9`. Search, article tags and Trash/restore are the current combined feature batch; qualification and remaining copy gates are recorded in the handoff. Full product/release acceptance remains open. The [technical plan](plan.md), [tasks](tasks.md) and [handoff](implementation-handoff.md) distinguish delivered behavior from remaining work; the [completion review](specification-review.md) records the original specification review.
**Input**: Replace the unsupported legacy Clipper foundation with a local-first, Jazz-backed clipping and reading app, with a standards-oriented browser extension and mobile share intake.

## Product direction

Clipper helps a person collect web articles, PDFs, and EPUBs; read and annotate them in one library; and access saved material offline. The first release prioritizes web clipping and reading, saved article images, cross-browser extension clipping/highlighting, same-account synchronized notes/highlights, and mobile PWA share intake. PDF/EPUB and RSS are valuable product features but are outside this initial MVP. Future directions are recorded below to inform current data and interface choices without expanding MVP scope.

The previous prototype is archived on `archive/pre-jazz-rewrite-2026-11-02`; it is not the implementation baseline. No legacy-data migration was required for the rewrite; this does not authorize deleting current stored identities or articles. Use Delightful Local First for identity and account recovery rather than implementing a second identity system.

### Current implementation checkpoint

PR #13 is merged at `2cd8731`; the user verified extension sign-in and saving into the web library. The Chromium clipper requires an explicit connection to an existing account. An unconnected toolbar click opens a trusted sign-in popup; successful DLF restoration confirms the selected account and resumes that gesture. Connected clicks save directly and display a top bar on the original page. The bar exposes machine-owned save status, Open article and Close; dismissal does not cancel or delete the save. Account restoration stays in trusted extension UI (the sign-in popup or Options), with credentials excluded from page code. One offscreen runtime owns the DLF/library actors and packaged extraction worker. Web Add Link opens a DUI modal from the shared floating action button on library and reader routes; submitting saves a URL article immediately; supplied browser content uses the same native operation. See [handoff](implementation-handoff.md) for the current branch, verified commit and checks.

This checkpoint does not mark the full stories below complete: Firefox packaging, source/reader annotations, downloaded images, richer reader controls, notes, global tag management, annotation search, permanent deletion and mobile/release qualification remain open. Full retry/backoff scheduling is not a prerequisite to reviewing the delivered clipper batch. Accepted scope cuts remain unchanged. The user selected basic library organization as the next bounded batch: Inbox/Later/Archive, an independent favorite flag, status/favorites views, native Jazz synchronization and offline restart. Bulk actions, tags, Trash, search, images and annotations are excluded from this batch. The implementation is in PR [#14](https://github.com/delightful-labs/delightful-clipper/pull/14); see [library-organization.md](library-organization.md) for ownership and [handoff](implementation-handoff.md) for qualification.

### Current combined batch — search, article tags and Trash/restore

The user authorized these capabilities together in one PR based on updated main after PR #15, with all tests run in the same session. [Search/tags/Trash design](search-tags-trash.md) records the inspected native schema and XState resource ownership. Article tag assignment/removal/filtering uses existing approved DUI action/noun labels. Native immutable histories add normalized tag membership and independent Trash/restore without replacing content, status or favorites. The worker searches title, URL and saved body text, combining status/favorite/tag filters with AND and excluding Trash unless explicitly selected.

This batch does not implement global tag rename/delete, annotation search/tags, permanent deletion, bulk actions, images or annotations. The user approved revised shared Search/Move to action templates, the Trash noun and short search error, rejected preparation feedback, and requested generic Enter-a-valid-value form feedback. The actual DUI search field, Trash radio/actions and tag field validation are implemented; native/worker fixture coverage is supplemented by real control and production-offline browser coverage. Existing Add Link and direct-reader Restore actions reuse approved wording. Full product acceptance remains open.

## User Scenarios & Testing

### User Story 1 - Capture and read a web article (Priority: P1)

A user saves an article from its URL or browser extension, then reads a clean article view in Clipper.

**Why this priority**: This is the core clipper and reader loop and anchors the MVP.

**Independent Test**: Save an article from a supported page, open it in the library, and read its extracted content.

**Acceptance Scenarios**:

1. **Given** a readable web page, **When** the user clips it, **Then** Clipper stores the source URL, useful article content, metadata, and library record and makes it available to read.
2. **Given** a page that cannot be parsed or fetched, **When** clipping is attempted, **Then** the user receives a useful failure state and can retry or retain a source link where possible.
3. **Given** an article in the library, **When** the user opens it, **Then** the reader presents article content with a table of contents derived from headings when available.
4. **Given** a pasted or shared URL redirects through a shortening or tracking service, **When** Clipper resolves it, **Then** it retains the submitted URL and redirect provenance and checks the resolved destination against existing documents before creating a duplicate library entry.
5. **Given** the resolved page declares a canonical URL, **When** Clipper evaluates document identity, **Then** it treats that declaration as evidence to validate rather than blindly replacing source identity or merging unrelated documents.

### User Story 2 - Read saved articles offline (Priority: P1)

A user can read a saved article, its annotations, and its images without a network connection.

**Independent Test**: Save an article and its images, disconnect the network, restart or reopen the app, and inspect article content, images, highlights, and notes.

**Acceptance Scenarios**:

1. **Given** a completed clip with downloaded images, highlights, and notes, **When** the user is offline, **Then** all of those are available for reading.
2. **Given** a clip whose image processing is still underway, **When** the user opens it, **Then** article text becomes readable before image processing completes and image progress or failures do not block reading.
3. **Given** an image cannot be retrieved, **When** the article is read offline, **Then** the rest of the article and annotations remain usable and the unavailable image is represented clearly.

### User Story 3 - Clip and highlight from a desktop browser (Priority: P1)

A user clips an open page or marks text on the original page using an extension supported by Firefox and Chrome.

**Independent Test**: Install the extension in supported Firefox and Chrome desktop environments, clip a page, create an original-page highlight, and verify it maps to the clipped article. Validate mobile capture separately through supported PWA/Add Link entry points; mobile extension availability is not assumed.

**Acceptance Scenarios**:

1. **Given** an eligible page and a confirmed connection to the app account, **When** the user clicks the extension toolbar action, **Then** Clipper initiates saving directly, retains the original page and shows a top bar with save status and an explicit Open article action; no separate Save confirmation or automatic reader navigation is required.
2. **Given** the user selects text on the original page, **When** they create a highlight, **Then** a durable anchor is stored and can be resolved against the extracted article when possible.
3. **Given** browser APIs differ, **When** a capability is unavailable, **Then** the extension offers a supported fallback or clearly communicates the limitation without corrupting annotations.
4. **Given** an extension and PWA share records, **When** either creates or updates an annotation, **Then** the same underlying document and annotation identity is used where the user is signed into the same account.
5. **Given** an active save or completed clip, **When** the user closes its page bar, **Then** the bar disappears without canceling or deleting the saved article; late status updates do not reopen it.
6. **Given** account recovery is needed, **When** the user opens extension Options and restores the same account as the PWA, **Then** credentials remain in trusted extension UI and subsequent clips use that account after old-account writes drain. No web-origin single sign-on is assumed.
7. **Given** the extension has no confirmed account connection, **When** its toolbar is clicked, **Then** a trusted sign-in popup requests the existing app account’s recovery phrase; no article/reference is saved and no rendered page content is captured before confirmation. Success resumes the original gesture; invalid input or closing before confirmation saves nothing.
8. **Given** the connection metadata names a different account or deployment than the actual SDK binding, **When** the toolbar is clicked, **Then** it cannot save into that binding and requests sign-in rather than trusting an unrelated local identity.

### User Story 4 - Share a page into Clipper on mobile (Priority: P1)

A user can add a link directly on any device, and may also send a page from another app into Clipper using PWA sharing where the platform supports it.

**Independent Test**: Use the platform share sheet to send a URL into the installed PWA on supported devices and confirm it enters the library or a clear completion flow.

**Acceptance Scenarios**:

1. **Given** any supported device, **When** the user chooses Add Link, **Then** they can enter or paste a URL to start clipping.
2. **Given** an installed PWA and a supported browser/OS share target, **When** the user shares a URL, **Then** Clipper receives it and starts or offers clipping.
3. **Given** a platform without share-target support, **When** the user wants to clip a page, **Then** the always-available Add Link/paste flow remains usable.
4. **Given** the app is not currently open, **When** a share target launches it, **Then** the shared URL is preserved through startup and is not lost during identity/session readiness.

### User Story 5 - Annotate saved reading (Priority: P1)

A user explicitly highlights text and writes plain-text article-level or highlight-attached notes, available in the reader and annotation collection.

**Independent Test**: Add highlights and both kinds of notes, reopen offline, and navigate from the collection to their saved context.

**Acceptance Scenarios**:

1. **Given** selected article text, **When** the user explicitly creates a highlight, **Then** it has a stable identity and resolves after reload when the saved text is available.
2. **Given** an unresolved or ambiguous annotation, **When** the user views the collection, **Then** the saved quote, notes, and source context remain accessible without silently attaching to a different passage.
3. **Given** an article or highlight, **When** the user edits its note, **Then** plain text autosaves locally with an honest save/sync status and survives offline restart.
4. **Given** overlapping highlights, **When** one is deleted, **Then** the others remain unchanged and Undo restores the deleted highlight with its attached notes and tags.

### User Story 6 - Organize and restore articles (Priority: P2)

A user organizes saved articles with reading status, favorites, and tags, using individual actions. This is launch scope after the core capture/read/annotate path.

**Independent Test**: Tag an article and highlight, change the article status/favorite, then Trash and restore the article offline.

**Acceptance Scenarios**:

1. **Given** an article, **When** its status changes between Inbox/Later/Archive, **Then** its independent favorite flag is preserved.
2. **Given** a shared tag, **When** it is assigned to an article or highlight, **Then** assignments remain specific to the selected item.
3. **Given** an article with annotations, **When** it moves to Trash and is restored, **Then** its content, notes, highlights, previous status, favorite flag, tags, and progress are retained.
4. **Given** an existing or trashed article, **When** its source is clipped again, **Then** Clipper offers Open or Restore as appropriate without duplicating the document, replacing the snapshot, or changing its status automatically.

### User Story 7 - Find saved reading offline (Priority: P2)

A user finds articles, highlights, and notes using offline search and accepted filters. This is launch scope after reliable local persistence.

**Independent Test**: Search for locally saved article text and note/highlight text while offline, navigate to results, and explicitly search Trash.

**Acceptance Scenarios**:

1. **Given** locally saved articles and annotations, **When** the user searches offline, **Then** labeled matching results navigate to the relevant article or saved annotation context.
2. **Given** an article in Trash, **When** the user performs a default search, **Then** that article and its annotations are excluded; an explicit Trash search can find them.
3. **Given** status/tag/favorite filters, **When** the user applies them, **Then** results honor their defined item/parent semantics without implicitly assigning tags to related records.

## MVP scope

**Scope boundary**: The user approved the four primary scope cuts: content refresh/revision migration and annotation-repair screens, highlight resizing, bulk actions and broad Undo, and device-specific preference overrides. Their previously accepted behavior is retained as future design intent. Saved typography presets and the DUI image viewer were subsequently deferred as well. Other secondary candidates remain in scope unless separately deferred. Remaining suggestions live in Open Questions; do not expand launch scope without an explicit decision.

- PWA web application backed by Jazz using identity/session and recovery capabilities imported from Delightful Local First.
- Private personal library. Documents and annotations are shared across the same user's signed-in devices and extension/PWA clients; public sharing and collaboration are outside MVP scope.
- Capture, extract, organize, and read saved web-article snapshots. Re-clipping reuses the existing snapshot and offers Open; content refresh and revision-history workflows are deferred.
- Offline access to saved article text, downloaded article images, highlights, and notes.
- Incremental image downloading, resizing, and compression that does not gate initial article display.
- Firefox and Chrome browser extension, using cross-browser web extension standards as far as possible, for clipping and highlighting on original pages.
- Shared document and annotation identity between extension and PWA.
- Mobile PWA share-target intake for URLs on platforms that support it, where supported; an always-available Add Link/paste flow provides a consistent alternative on every device. Share intake must be tested on target devices.
- Unified highlights, notes attached to highlights, and article-level notes without a text selection, with resolvable anchors where applicable and an annotation collection.
- Tags on articles and individual highlights, using one shared vocabulary within the user's library.
- Offline search across locally saved article text, highlights, article-level notes, and notes attached to highlights.
- Inbox, Later, and Archive reading statuses, with an independent favorite flag on articles.
- Restorable Trash for deleted articles, preserving their saved content, highlights, and notes until a separate permanent-deletion action.
- Heading-based table of contents when extracted structure supports it.
- Reader typography controls for font family, font size, line spacing, and reading width, with saved account preferences. Named presets and automatic matching by reading-area width are deferred.
- Account-synced reader preferences without device-specific overrides; individual library actions without bulk selection or broad Undo. Highlight-delete Undo and Trash/Restore remain included.
- State-machine-driven workflows where meaningful, with non-UI document parsing and image processing outside the UI thread.
- Netlify hosting as the deployment target.
- English user-facing text at launch, with strings kept localizable. Internationalization using i18next is the requested direction; Svelte integration, SSR/locale isolation, and extension catalog sharing need technical validation during planning.

## Deferred and future product direction

- Storage-usage reporting and controls to remove downloaded images while retaining article text and annotations. Explicitly deferred by the user to limit MVP scope.

The following are intentionally not MVP requirements. They should inform data modeling and extension boundaries where relevant:

- Explicit content refresh, revision migration/history, retained historical assets, annotation-repair/candidate-confirmation screens, and reading-position migration between revisions. Preserve representation/selector version information in the model without building these workflows for launch. Previously accepted future behavior is recorded below.
- Resizing existing highlights; MVP supports creating and deleting highlights.
- Bulk library actions and broad Undo for status/tag/Trash actions; MVP retains individual actions, highlight-delete Undo, and Trash/Restore.
- Device-specific overrides of account reader preferences. MVP syncs one account preference set; System theme follows each device locally.
- Estimated reading-time display and its estimation method, including personalization and remaining-time estimates. Reading progress and saved reading position remain in MVP.
- Saved typography presets and responsive preset matching. Future presets record the current browser width by default, use mobile-first width ranges with reasonable tolerance, and preferably apply through CSS custom properties. Basic typography controls remain in MVP.
- A zoomable article-image viewer. Inline offline article images remain in MVP. When implemented, the reusable viewer belongs in Delightful UI (DUI), with accessible closing, offline-image support, and restoration of Clipper reading position.

- PDF and EPUB ingestion/reading; PDFs should support both page view and flowing-text view.
- RSS feed management and reading, inspired by Readwise Reader.
- Readwise library and RSS feed import; decide later between an in-app importer and a one-time tool.
- Browser/mobile app wrapping, pending PWA platform research.
- User-loaded custom reader fonts. Font acquisition and loading are deferred design decisions; possible approaches include font-file uploads and selection from Google Fonts. This is outside MVP scope.
- An optional setting to create highlights automatically when text is selected. MVP requires an explicit highlight action; automatic highlighting may be offered as a user preference later.
- Multiple highlight colors. MVP uses one color, while annotation modeling and rendering must allow additional colors later.
- App-specific keyboard shortcuts for highlighting, notes, article status changes, and library navigation are outside MVP scope. Standard keyboard operation and accessible focus/navigation remain required; this deferral does not remove keyboard access to controls.
- Saved custom library/search views. MVP provides reading-status, tag, and favorite filters; saving reusable custom views is deferred.
- Manual editing of captured article metadata, including title and author. MVP displays captured/extracted metadata; user editing is outside MVP scope.
- User-facing export of highlights and notes, including basic Markdown export, is deferred beyond MVP.
- Bulk link intake, including pasting multiple URLs into Add Link. MVP accepts one URL per Add Link submission.
- Power- and data-saving policies for capture, image downloading, and retry workflows, including adaptation to device or user saving preferences. These are future capabilities and outside MVP scope.
- Public sharing of articles or annotations and collaboration between users. MVP is a private personal library; same-account synchronization and mobile share intake remain in scope.
- Paginated article reading. MVP uses continuous scrolling; a paginated reading mode is deferred.
- Email newsletter importing, built-in dictionary, and AI document tools.
- Full Web Annotation import/export and interoperability with other annotation services. MVP anchoring uses W3C-compatible selector concepts as described below.
- Standoff markup and standoff JSON for entity references, such as identifying people across documents.
- AT Protocol research and possible interoperability.
- Video/audio offline capture policy.

## Constraints and design principles

- Treat local UI as the UI thread. CPU-heavy or network/file workflows not tied directly to an immediate interaction should run in workers where the browser permits; keep parsing, extraction, image processing, and other suitable background work off the UI thread.
- Model meaningful workflows with reusable XState machines. Keep workflow logic separate from presentation and model cancellation, retries, partial completion, and cleanup explicitly.
- Prefer standards for browser extension and annotation interoperability, but verify actual Firefox/Chrome API and mobile platform support before committing to platform behavior.
- Preserve source identity and use W3C-compatible quote and position selectors, with separate anchor bundles for original-page and extracted-article representations. Keep one annotation identity across views, preserve the original selectors when deriving another anchor, and expose ambiguous or unresolved matches explicitly. Detailed normalization and matching algorithms remain planning decisions.
- Clipper owns document domain behavior. Shared generic UI belongs in Delightful UI when it is appropriate across apps. The future reusable image viewer with zoom belongs in Delightful UI; Clipper owns article-image integration and reading-position preservation. The viewer is deferred beyond MVP.
- Use strict TypeScript, clear data contracts, and clean module boundaries. Avoid copying legacy implementation decisions without review.

## Edge Cases

- Extraction returns no article body, a partial article, or materially different text from the source.
- The original page changes, has duplicate text, or removes/reorders content after an anchor was created.
- A site is behind authentication, blocks automated retrieval, or uses client-rendered content.
- A pasted/shared URL is shortened, redirects through tracking services, resolves differently over time or by session, or declares a conflicting canonical URL. Redirect resolution may fail offline, loop, or exceed a bounded redirect limit.
- A short-link capture and a direct-URL capture resolve to the same article after both have already entered pending capture workflows.
- Image URLs expire, redirect, return oversized assets, fail processing, or contain unsupported formats.
- The user goes offline during clip creation, annotation save, or image download.
- A mobile share intent arrives before identity/session readiness, or contains malformed/unsupported data.
- Browser extension APIs or store policies differ across Firefox and Chrome, especially on mobile Chrome.
- A document contains malformed heading structure, nested footnotes, or text that resembles a footnote without clear semantics.
- Typography or viewport changes alter article layout while a saved reading position must still resolve. Responsive preset matching is a future concern.
- The account changes while local document or annotation work is pending.

## Requirements

### Functional Requirements

- **FR-001**: Users MUST be able to clip a web page and read its extracted article in a clean reader. Retained article content MUST support native `details`/`summary` disclosures and a sanitized static inline SVG subset. Apply the shared content policy during extraction and again when displaying saved HTML; scripts, embedded active content and remote SVG resources MUST NOT execute or load. The supported subset and exclusions are defined in [design-decisions.md](design-decisions.md#retained-disclosure-and-svg-content); this does not require arbitrary SVG feature support.
- **FR-002**: The system MUST retain the submitted source URL and sufficient source metadata to identify and revisit a clipped page. URL-based intake, including Add Link and mobile sharing, MUST account for redirects and shortening services: retain the observed redirect chain and final destination when available, evaluate publisher-declared canonical URLs, and check supported evidence of URL equivalence against existing documents before creating a duplicate library entry. Canonical declarations alone MUST NOT cause unrelated documents to be merged. Failed or deferred resolution MUST preserve the submitted URL and a recoverable capture state.
- **FR-003**: A saved article's text, downloaded images, highlights, and notes MUST remain readable offline after local persistence completes.
- **FR-004**: Saving an article MUST automatically initiate downloading its article images for offline use. Image acquisition and processing MUST proceed incrementally in the background and MUST NOT prevent initial text reading. Image retrieval and resizing/compression should be owned by background workflows and run outside the UI thread where browser capabilities permit. Pending or failed downloads MUST expose their status and support retry when connectivity is available.
- **FR-005**: The reader MUST provide a navigable table of contents for extracted headings when available. Detected footnote references MUST open their note in a small popover, with a way to reach the full note location when needed.
- **FR-006**: Users MUST be able to create and revisit highlights, notes attached to highlights, and article-level notes associated with a document. Creating an article-level note MUST NOT require a text selection or range anchor. Both article-level and highlight-attached notes MUST be accessible in the reader and annotation collection. Article-level notes MUST attach to the document's stable identity. Their future persistence across content refreshes remains design intent, without requiring refresh in MVP.
- **FR-007**: The browser extension MUST support clipping and original-page highlighting in Firefox and Chrome within platform API capabilities. Without a confirmed account connection, a toolbar click MUST open a trusted sign-in popup and MUST NOT save an article or scrape page content. A completed DLF restoration MUST establish a connection scoped to the selected account and Jazz app/server; a canceled or failed sign-in MUST NOT authorize clipping. A stored local identity alone MUST NOT count as signed in. With a verified connection, a toolbar click MUST initiate saving directly while retaining the original page, with an in-page top bar for machine-owned save status, an explicit Open article action and Close. Closing this bar MUST affect presentation only, not cancel or delete a save. Account recovery/restoration MUST remain in trusted extension UI; credentials MUST NOT enter source-page code. Prefer rendered-page capture with packaged worker extraction. Chromium direct clipping is implemented; Firefox packaging and highlighting remain open, rather than being implied by the Chromium evidence.
- **FR-008**: Original-page highlights MUST preserve W3C-compatible quote and position selectors and source context. Original-page and extracted-article anchors MUST be associated with their respective representation/version under one annotation identity; deriving another anchor MUST preserve the original selector bundle. Ambiguous and unresolved matches MUST be exposed explicitly, with the saved quote and notes remaining accessible.
- **FR-009**: Extension and PWA operations MUST identify the same document and annotations for a shared account.
- **FR-010**: The PWA MUST provide an Add Link/paste flow on every supported device. It MUST accept shared URLs through platform share-target mechanisms where supported; this capability MUST be tested on target devices and MUST NOT be required for clipping.
- **FR-011**: User-visible text MUST be localizable, and the implementation MUST use i18next if technical planning confirms suitable Svelte/SvelteKit integration.
- **FR-012**: The reader MUST provide controls for font family, font size, line spacing, and reading width, with persisted preferences. Built-in font choices are a design decision; custom font loading is deferred. Saved named presets and automatic preset matching for different reading-area sizes are deferred beyond MVP; their previously accepted width-range behavior remains future design intent.
- **FR-013**: Stateful workflows MUST expose meaningful loading, success, partial-success, retry, cancellation, and failure outcomes as applicable.
- **FR-014**: Suitable CPU-intensive parsing and image processing MUST run outside the UI thread.
- **FR-015**: The system MUST use Delightful Local First for identity and recovery rather than creating a separate account recovery system.
- **FR-016**: The app MUST be deployable to Netlify.
- **FR-017**: The system MUST not require migration of legacy Clipper data; no user data exists to preserve.
- **FR-018**: Clipping an already-saved article MUST preserve its current reading status, progress, annotations, and saved snapshot. The user MUST receive an Already saved message with an Open action. Re-clipping MUST NOT move the article back to Inbox or replace its content. An explicit Refresh action is deferred beyond MVP.
- **FR-019**: **Deferred — content refresh and revision retention.** Future refresh will save changed content as a new revision under the same document and open it after local text persistence, retaining revisions/assets referenced by annotations and leaving readable content intact on failure.
- **FR-020**: **Deferred — ambiguous-match repair interface.** Future repair will offer candidate selection and original-context access, requiring user confirmation. MVP MUST expose ambiguous/unresolved status and preserve the saved quote and context; it MUST NOT silently select among ambiguous matches. A candidate-selection screen is not required for launch.
- **FR-021**: **Deferred — approximate matching and confirmation interface.** Future approximate matches, including a single candidate, will require confirmation and preserve the original quote/anchor/context. MVP may leave changed text unresolved instead of generating approximate candidates.
- **FR-022**: **Deferred — reading-position migration across refreshed revisions.** Future refresh will restore a confidently matched equivalent position or start at the beginning, preserving the old position with its original revision.
- **FR-023**: **Deferred — unchanged-refresh handling.** Future unchanged refresh will show Already up to date without creating another content revision or changing positions/anchors.
- **FR-024**: Users MUST be able to assign and remove tags on articles and individual highlights using one shared vocabulary within their library. Article and highlight tag assignments MUST remain distinct; reusing a tag MUST NOT implicitly assign it to an item's parent or children.
- **FR-025**: Users MUST be able to search locally saved article text, highlights, article-level notes, and notes attached to highlights without a network connection. Results MUST identify the matching article or annotation and support navigation to it. Annotations that are ambiguous or unresolved in the current revision MUST remain searchable, with access to their saved original context. Search indexing and query execution MUST follow the existing worker/background-work constraints where browser capabilities permit; indexing must reflect local additions, edits, and removals. Search matching, ranking, and index implementation remain planning decisions.
- **FR-025a**: Search MUST exclude articles in Trash and their associated highlights and notes by default. Users MUST have an explicit way to search Trash, including its retained article text, highlights, and notes, subject to local availability.
- **FR-026**: Users MUST be able to organize saved articles into Inbox, Later, or Archive, with exactly one of these statuses per article. Newly clipped articles MUST enter Inbox by default across capture entry points; re-clipping and restoration MUST preserve their accepted existing-status behavior. Articles MUST also support an independent favorite flag; marking or unmarking a favorite MUST NOT change reading status, and moving an article between statuses MUST NOT clear its favorite flag.
- **FR-027**: Deleting an article MUST move it to restorable Trash, preserving its saved content, highlights, notes, previous Inbox/Later/Archive status, favorite flag, tags, and reading progress. Restore MUST return the article to that previous status with those records and settings intact. Trash MUST have no automatic expiry in MVP; articles MUST remain restorable until the user explicitly permanently deletes them. Permanent deletion MUST be a separate explicit action with confirmation that communicates the removal of the article and its associated highlights and notes. Permanent-deletion cleanup across local storage and synced devices remains a planning decision.
- **FR-028**: When clipping resolves to an existing article in Trash, the system MUST offer Restore rather than create a duplicate document or restore it automatically. The article MUST remain in Trash until the user chooses Restore; restoration MUST preserve its retained saved content, highlights, and notes.
- **FR-029**: Creating a highlight in MVP MUST require an explicit user action in both the reader and browser extension. Selecting text alone MUST NOT save a highlight. A setting for automatic highlighting on selection is deferred.
- **FR-030**: MVP MUST use one highlight color. The annotation model and rendering contracts MUST support adding multiple highlight colors later without changing annotation identity or anchor semantics. Existing highlights MUST remain valid and render with the default color when future color metadata is absent; the exact extensibility mechanism is a planning decision.
- **FR-031**: **Deferred — highlight resizing.** Future resizing will preserve highlight identity, notes, and tags, update the edited representation’s quote/anchor, and re-evaluate other representations. MVP supports creation and deletion without a resize interaction.
- **FR-032**: Overlapping highlights MUST remain separate annotations with independent identities, notes, and tags. Creating a highlight into an overlap MUST NOT automatically merge it with another highlight. Future resizing must preserve this rule, but resizing itself is deferred. Users MUST be able to access each annotation in an overlapping region; the visual treatment and selection interaction remain planning decisions.
- **FR-033**: Deleting a highlight MUST also delete its attached notes and offer an Undo action. Undo MUST restore the same highlight identity, attached notes, tag assignments, and anchors together. Deleting one highlight MUST NOT affect overlapping highlights or article-level notes. Undo availability and synchronization mechanics remain planning decisions.
- **FR-034**: Each article and each highlight MUST support one editable plain-text note in MVP. Multiple separate notes per item and rich-text formatting are outside MVP scope. Detected HTTP(S) URLs MUST be displayed as clickable links when viewing a note. Note text MUST remain literal text rather than being interpreted as HTML or Markdown.
- **FR-035**: Article-level and highlight-attached note edits MUST save automatically and expose a visible save status. Editing MUST work offline, and the status MUST distinguish local persistence from pending synchronization so network availability does not gate saving. Unsaved text MUST be protected when closing the editor, navigating, or encountering a save failure, with a recoverable draft or an explicit warning when persistence cannot complete. Save timing, draft recovery, and concurrent-edit handling remain planning decisions.
- **FR-036**: Users MUST be able to choose Light, Dark, or System theme in MVP. System mode MUST follow the device's current color-scheme preference and respond to changes. The selected mode MUST persist locally and remain usable offline. Theme colors MUST keep article text, highlights, notes, and interactive controls legible in each mode.
- **FR-037**: Theme and typography preferences MUST sync across devices signed into the same account and remain locally usable offline. System theme MUST follow each device’s own color-scheme preference. Device-specific overrides are deferred; the accepted future behavior is local precedence without changing shared preferences, with clearing an override returning to the shared set.
- **FR-038**: Library search MUST support filters for reading status (Inbox, Later, or Archive), tags, and favorites. These filters MUST work offline over locally available records and MUST respect the default exclusion of Trash and the explicit Trash search scope. Saved custom views are deferred; detailed filter-combination and annotation-result semantics remain planning decisions.
- **FR-039**: **Deferred — bulk library actions.** Future bulk actions will add/remove tags, change status/favorites, and move selected articles to Trash, preserving unrelated data and exposing partial failures. MVP supports these operations on individual articles.
- **FR-040**: The MVP library MUST be private to its owner. Same-account devices, the PWA, and the browser extension MUST access the owner's shared documents and annotations within the identity and authorization model provided by Delightful Local First and Jazz. Public sharing and collaboration between users are outside MVP scope; mobile sharing into Clipper remains an intake capability.
- **FR-041**: Opening a saved article MUST automatically restore its last saved reading position for that content revision, including after restarting the app offline. Reading-position updates MUST persist locally without requiring network access. Restoration MUST locate the saved content across typography and viewport changes where possible rather than relying solely on a raw scroll coordinate. MVP restores positions within the saved snapshot; migration after a future content refresh is deferred under FR-022. Synchronization and concurrent-position conflict handling remain planning decisions.
- **FR-042**: Reading positions MUST sync across devices signed into the same account. Opening an article MUST restore the latest available saved position for its revision, using local data when offline. Receiving a position update from another device MUST NOT automatically scroll or otherwise move an article that is already open. Position ordering and conflict resolution, including unsynced local updates, remain planning decisions.
- **FR-043**: Reaching the end of an article MUST NOT automatically archive it or change its reading status. The reader MUST offer an Archive button at the bottom of an article that is not already archived, recommending archiving as an explicit user action.
- **FR-044**: The library MUST display reading progress for saved articles using locally available data so it remains available offline. Its calculation and relationship to last saved position remain planning decisions. Estimated reading-time display and its estimation method are deferred beyond MVP; no reading-speed formula or personalization policy has been selected.
- **FR-045**: The reader MUST offer a distraction-free mode that hides library panels and nonessential reading controls until requested. Users MUST have an accessible way to reveal controls and exit the mode using standard pointer, touch, or keyboard operation. Highlighting, notes, reading-position persistence, and offline reading MUST remain available in this mode; detailed reveal interactions remain a design decision.
- **FR-046**: Article reading MUST use continuous scrolling in MVP. Paginated article reading is outside MVP scope.
- **FR-047**: **Deferred — zoomable image viewer.** Future image activation will open an accessible zoom viewer supporting offline images and return to the same reading position on close. The reusable component belongs in Delightful UI (DUI); Clipper supplies article-image data and reading-position integration. MVP renders saved images inline without requiring this viewer.
- **FR-048**: Article links MUST preserve normal browser navigation behavior: same-tab navigation by default, with standard browser controls available for opening another tab or window. Returning to Clipper MUST restore the saved reading position. Any explicit action that opens a new tab or window MUST communicate that behavior in its accessible label or accompanying text. Internal article anchors and footnote links MUST retain their intended in-document behavior, including the footnote popover requirement in FR-005.
- **FR-049**: **Deferred — broad action Undo.** Undo for article status/tag changes and moves to Trash, including bulk actions, is outside MVP. Highlight-delete Undo (FR-033) and article Trash/Restore (FR-027) remain required. Future broad Undo must restore affected values without reverting unrelated edits.
- **FR-050**: Activating a tag MUST open a filtered view of articles and individual highlights explicitly assigned that tag, with each result clearly identified as an article or highlight. A parent or child MUST NOT be included solely because a related item carries the tag. Results MUST support navigation to the article or highlight context, work offline over locally available records, and respect Trash search scope. This tag-filtered view does not imply saved custom views.
- **FR-051**: Users MUST be able to rename and delete tags globally within their library. Renaming MUST update the shared tag and all its article/highlight uses, including retained items in Trash. Deleting MUST remove the tag and its assignments without deleting or changing the content of articles, highlights, or notes. Tag-name matching MUST trim leading/trailing whitespace and treat capitalization differences as the same tag. Name collisions, Unicode case handling, offline/concurrent changes, and rename behavior remain planning decisions; a dedicated tag-merge interface is not implied.
- **FR-052**: Successful clipping from the browser extension MUST leave the user on the original page and show a saved confirmation with an explicit Open in Clipper action. Clipping alone MUST NOT navigate away or automatically open another tab/window. The confirmation MUST distinguish a completed local save from a pending capture or failed attempt; existing-document and Trash matches MUST follow FR-018 and FR-028. Any new-tab/window behavior for Open in Clipper MUST be communicated according to FR-048.
- **FR-053**: Submitting Add Link in the PWA MUST immediately save an article object containing the submitted URL, without a separate preview confirmation or Save action. The same save operation MUST accept optional supplied content for browser clipping. A separate state machine in a dedicated Web Worker MUST process saved article objects missing content one at a time. For this PWA flow, successful clipping MUST keep the user in the library; the saved title provides reader navigation. At the user’s subsequent request, do not render processing/sync confirmation text, Cancel or a separate Open saved article action. Retain Already saved for duplicate captures and preserve the submitted URL and existing row Retry for recovery. Redirect resolution, duplicate matches, and Trash matches MUST follow FR-002, FR-018, and FR-028.
- **FR-054**: When clipping a valid source URL fails to produce usable article content, Clipper MUST retain a link-only library entry with the submitted source URL, a useful failure reason, and a Retry action. It MUST clearly distinguish the entry from a successfully saved readable article and preserve available redirect/source provenance. Retry MUST update the same entry on success or reconcile it with an existing matching document without losing user data. The retry of a failed initial capture MUST NOT replace an existing readable snapshot with a link-only entry. Refresh of successfully saved content is deferred under FR-019.
- **FR-055**: Add Link MUST accept one URL per submission in MVP. If input contains multiple URLs, the flow MUST ask the user to submit one URL at a time rather than silently choose one or start a batch. Bulk link intake is deferred.
- **FR-056**: Clipping workflows MUST continue when the user navigates elsewhere within the running Clipper app. Capture state MUST be owned independently of the initiating view and expose progress, completion, and failures in the library. Internal navigation MUST NOT discard pending work. Browser suspension or app termination MUST leave durable recoverable state; uninterrupted execution while the browser/app is closed is not required.
- **FR-057**: Pending clips and image downloads interrupted by connectivity loss MUST resume automatically when connectivity returns and the relevant app/extension runtime is available. Connectivity-related failed image downloads MUST also retry automatically; manual Retry MUST remain available. Retry workflows MUST preserve completed work, avoid duplicate documents/assets, and use bounded attempts/backoff to avoid endless retries for permanent failures. Power- and data-saving options and adaptive policies are deferred beyond MVP.
- **FR-058**: Images saved for offline article reading MUST be subject to default size and compression limits to manage local storage while remaining usable as inline article images. The deferred zoomable viewer does not impose additional MVP image-quality requirements. Exact dimension/file-size limits, encoding formats, compression quality, and handling of images that cannot meet those limits MUST be decided during planning. Processing MUST follow FR-004 and MUST NOT block initial text reading.

- **FR-059**: The initial library presentation MUST be a single list sorted by original save date, newest first. Re-clipping MUST NOT change the original save date or reorder the existing item. Additional layouts and user-selectable sort modes are outside MVP scope.
- **FR-060**: When extraction produces usable content that is known or suspected to be incomplete, Clipper MUST retain that content, clearly mark the capture as partial, preserve the source link, and offer Retry. A failed retry MUST NOT discard readable content or annotations, and partial content MUST NOT be presented as a completed full capture. Define safe retry completion and anchor handling during planning without introducing the deferred general refresh workflow.
- **FR-061**: MVP MUST ship English user-facing text while keeping strings localizable under FR-011. Additional launch translations or a translation-management interface are not required.

### Key Entities

- **Document**: A saved source and its normalized readable representation, including source identity, metadata, content structure, availability status, one reading status (Inbox, Later, or Archive), an independent favorite flag, and a separate Trash lifecycle state.
- **Source capture**: A capture attempt and its origin, including submitted URL, observed redirect chain and destination, publisher-declared canonical URL and its validation outcome when available, browser/PWA entry point, extraction outcome, and timing. Distinguish observed URLs from accepted document aliases.
- **Saved representation**: Captured source or extracted readable content tied to a stable representation identifier and normalization/selector version. MVP keeps the saved article snapshot; future refresh revisions are deferred.
- **Asset**: An image or other referenced resource associated with a document, including processing and offline availability outcomes.
- **Annotation**: A highlight or note associated with a document. A note may attach to a highlight or to the article as a whole; article-level notes attach to the stable document identity, do not require an anchored text range, and persist across content revisions.
- **Anchor**: A selector bundle tied to a source-page or extracted-article representation/version, including W3C-compatible quote and position information and its resolution status. One annotation may have distinct anchors for different representations.
- **Tag**: A reusable library label from a vocabulary shared by articles and highlights, with separate assignments to each tagged item.
- **Reader preference**: Account-synced theme, typography, and layout settings. Named presets with reading-area matching and device-specific overrides are deferred beyond MVP.
- **Feed / subscription** *(deferred)*: An RSS source and its entries, reading state, and relationship to captured documents.
- **Entity reference** *(future)*: A typed standoff annotation linking a span in a document to a person or other entity.

## Success Criteria

- **SC-001**: A user can capture and open a readable supported web article in under 30 seconds on a typical network connection, excluding prolonged source-site response times.
- **SC-002**: After a clip and image processing report local completion, a user can disconnect and access the full article text, available captured images, highlights, and notes after reopening the app.
- **SC-003**: A user can create an original-page highlight in a supported extension environment and resolve it against the matching clipped article in at least 90% of a representative fixture set; unresolved cases remain visible and recoverable.
- **SC-004**: A URL shared through a supported mobile share target reaches a durable pending or saved state without being lost during app startup.
- **SC-005**: A user can adjust reader typography, reopen the app offline, and retain the saved settings. Named presets and responsive preset matching are not launch acceptance criteria.
- **SC-006**: A deployment preview on Netlify supports the app's required routing, worker assets, and PWA entry points.
- **SC-007**: Re-clipping a resolved source reuses its saved snapshot without resetting status/progress; a Trash match offers Restore and restores associated data without duplication.
- **SC-008**: Locally saved highlights and both note types survive offline restart and become available on another same-account client after synchronization, without exposing the private library to another account.
- **SC-009**: Offline search locates locally saved article, highlight, and note text; default search excludes Trash and explicit Trash search includes retained matching content.
- **SC-010**: Reopening a saved article restores its position across viewport/typography changes where resolvable, while a received remote position does not move an article already open.
- **SC-011**: A known partial extraction retains readable content with an incomplete label and Retry; a failed retry preserves saved content and annotations. The library lists saved articles newest first without reordering duplicates, and both note types provide one editable note per item.

## Assumptions

- The MVP has no legacy data migration requirement.
- Delightful Local First will provide the identity/recovery integration needed by Clipper; its exact package API and compatibility must be checked during planning.
- Initial browser targets are Firefox/Chrome desktop extensions and the PWA on Chrome Android and Safari iOS. Chrome Android incoming PWA sharing requires device qualification; Safari iOS uses Add Link unless incoming sharing becomes available and is qualified. Record minimum supported versions during release qualification.
- Chrome Android has no launch extension requirement; mobile capture uses supported PWA intake or Add Link. Desktop extensions use browser-specific packaging.
- “Offline available” means local persistence has completed for the article text, captured images, highlights, and notes; in-progress image assets may be individually pending or unavailable.
- The extension and PWA are developed in tandem in this repository, sharing domain contracts and schemas.
- i18next is selected with separate runtime instances and bundled English catalogs; reactive integration and locale isolation require implementation qualification.
- No visual direction has been selected; detailed design and CSS tokens are planning topics.

## Planning disposition and deferred questions

The accepted product scope is complete. [Design decisions](design-decisions.md) resolve launch defaults for reader controls, note save timing/conflict protection, search/filter semantics, tags, navigation/focus, overlap access, positions/progress, deletion/Undo, URLs and image processing. The [technical plan](plan.md), [data model](data-model.md), and contracts define implementation boundaries. Their runtime proof gates do not imply additional product features or completed engineering validation.

- **Selected for launch**: one repository; Readability baseline; W3C-compatible versioned quote/position selectors; i18next; pinned Jazz/DLF candidate integration; trusted extension-origin restoration; public-source first-party capture; locally durable snapshots and byte assets. See the plan for exact versions, actor ownership and platform fallbacks.
- **Qualification, not unanswered product scope**: package compatibility; deployed private authorization; first-library provisioning and crash reconciliation; gateway request-proof acquisition/native deployment; extension CSP/WASM/storage; extraction and normalization fixtures; real browser/device minimum versions; cold/offline restart; image quality and size defaults. The plan records these as gates, without claiming they passed.
- **Future discussion only**: reading-time estimation/personalization; custom font acquisition; named typography presets; DUI image viewer; PDF/EPUB libraries; Readwise import as a product feature versus a migration tool; refresh/revision and annotation-repair workflows; highlight resizing; bulk/broad Undo; device preference overrides; power/data-saving policies.
- **Unselected optional ideas**: configurable library layouts/sorts, capture-history dashboard, highlight merging, image galleries and separate reading-completion tracking. They remain outside MVP.

English launch, one editable plain-text note per article/highlight, newest-original-save-first list, safe partial retries, explicit permanent deletion and accessible operation remain unchanged. No additional feature-selection round is required. Any engineering failure that would weaken an accepted requirement needs a scoped decision before shipping.

## Scope review (2026-11-02; primary cuts approved)

### Assessment

Before reduction, the draft had 59 functional requirement entries, including FR-025a, and all five broad user stories were marked P1. Requirement count alone is not an effort estimate: many entries clarify safe behavior. The expansion comes from independently shippable workflows and their interactions, especially versioned refresh, annotation repair, multi-item operations, cross-device overrides, and management screens. At that point, the top-level MVP bullets and six success criteria no longer summarized all accepted scope; they have now been reconciled for the approved reduction.

The user approved the four primary cuts presented in the summary: refresh/revision migration and repair screens, highlight resizing, bulk actions/broad Undo, and device preference overrides. Those cuts are applied to the requirements, with future intent retained. The user subsequently also deferred saved typography presets and the DUI image viewer. Other secondary candidates remain in MVP pending a separate decision. Requirement IDs are preserved for traceability, including explicitly deferred entries. No implementation estimates or runtime validation are claimed.

### Recommended launch boundary

A person can save a web article, read its text and images offline, highlight and write notes, find it again, and resume reading across their own signed-in clients.

Keep these capabilities:

- Jazz-backed private library and Delightful Local First identity/recovery; shared extension/PWA document and annotation identity.
- One-URL Add Link and browser-extension capture, rendered-page extraction where available, redirect/short-link handling, conservative duplicate recognition, and a recoverable link-only failure entry.
- Continuous clean reading; local text/images/annotations; incremental image processing; background work independent of the current view; bounded reconnect retries and honest save/availability states.
- Explicit one-color highlights, plain-text article/highlight notes with autosave, W3C-compatible selector evidence, and durable original context. Separate overlapping highlights and honest unresolved/ambiguous states remain necessary correctness rules. Approximate matching and candidate-selection interfaces are deferred: show unresolved/ambiguous status instead of guessing.
- Inbox/Later/Archive, favorites, basic article/highlight tag assignment, simple offline keyword search, and per-article Trash/Restore with metadata preservation. Keep actions on one article at a time initially.
- Last reading position persisted locally and synced without moving an already-open article; light/dark/system themes and typography controls with saved preferences. Named presets and responsive matching are deferred. Simplify preference precedence by omitting device overrides initially.
- Original table-of-contents and footnote behavior, standard accessible link/navigation behavior, localization-ready strings, and Netlify deployment.
- Always-available mobile Add Link. Keep share-target intake conditional on supported/tested platforms, as already specified; do not promise unsupported extension runtimes or a native wrapper.

### Reviewed deferrals, in priority order

The first four rows are approved. Saved typography presets and the zoomable DUI image viewer were subsequently deferred; other rows remain optional proposals and have not been applied.

| Candidate | Requirements affected | Proposed launch simplification and reason |
| --- | --- | --- |
| Explicit content refresh and revision migration | FR-018 refresh action, FR-019–FR-023; refresh-dependent clauses in FR-006, FR-024, FR-041 | Save an immutable article snapshot and reuse it on re-clip. Defer refresh, retained historical assets, re-anchoring across revisions, changed-version reading-position migration, and candidate-confirmation screens. Keep representation IDs/selector versions in the design and never silently attach an uncertain match. This is the largest coherent cut. |
| Highlight resizing | FR-031 | Create/delete highlights initially. Editing a selection across source and reader representations adds interaction and anchor-invalidation work. Preserve independent overlapping annotations under FR-032. |
| Bulk actions and broad Undo | FR-039, bulk portions of FR-049 | Ship per-article actions. Keep highlight-delete Undo (FR-033) and safe Trash/Restore; defer bulk selection and batch recovery. Prefer deferring tag/status Undo over weakening protection for user-authored notes. |
| Per-device preference overrides | Device-override portions of FR-037 | Sync one account preference set; keep local caching and per-device interpretation of System theme. Typography controls remain; saved presets and width matching were subsequently deferred. |
| Global tag management and combined tag-results view | FR-050–FR-051 | Keep assigning/removing shared tags and basic filtering. Defer dedicated global rename/delete and the mixed article/highlight tag browser. |
| Reading-time indicators | Reading-time portion of FR-044 | Approved subsequent deferral: omit reading-time display and estimation. Keep reading progress and resume position; progress calculation remains planning work. |
| Distraction-free mode | FR-045 | Ship a readable responsive layout first; defer a separate mode and reveal/exit interactions. |
| Saved typography presets | Preset portions of FR-012/FR-037; SC-005 | Approved subsequent deferral. Keep typography controls and saved account settings; defer named presets and responsive width matching. |
| Zoomable image viewer | FR-047; related FR-058 viewer-quality constraint | Approved subsequent deferral. Keep inline offline images. Future viewer ownership remains in DUI, with reading-position preservation in Clipper. |
| Advanced search facets and Trash full-text search | FR-038 and the explicit Trash-search capability in FR-025a | Keep basic offline keyword search and default Trash exclusion; use a restorable Trash list initially. Unified annotation search stays in the recommended core; the query implementation still needs an early feasibility check. |

The approved reduction includes the four primary cuts plus saved typography presets and the DUI image viewer. Reading-time estimation/display was also subsequently deferred. Reading progress and other secondary candidates remain launch requirements. Additional cuts require another explicit scope decision.

### Follow-through status and remaining planning

- Applied: reconciled affected FRs, scenarios, MVP bullets, and success criteria, retaining the deferred behavior as future intent.
- Applied: separated annotation (P1), organization (P2), and offline discovery (P2) stories. P2 here is still launch scope, sequenced after the core path.
- Validate the main technical uncertainties before scheduling: extraction and URL resolution under browser/CORS limits, extension identity access, local asset persistence and worker support, cross-view anchoring, and offline search indexing. Determine supported browser/device versions and share-target feasibility.
- Keep end-to-end launch acceptance centered on capture → read → annotate → offline restart → sync, plus duplicate capture, failed capture/retry, and Trash/Restore. Add feature-specific acceptance only for capabilities retained in launch scope.

## Readwise reference research (2026-11-02)

These observations inform planning; they do not select Clipper's anchor implementation. Evidence comes from the user-provided `/Users/matt/Desktop/index.js` extension bundle and a shared Chrome session using one saved i18next article. The bundle and live application may be different builds. Server implementation and broader site compatibility have not been inspected.

### Persisted records

- Articles, highlights, and notes use document records with `category` distinguishing their type. An article's `children` contains highlight IDs; a highlight's `parent` points to the article and its `children` contains note IDs; a note's `parent` points to its highlight. Separate note records were confirmed in the live state API response.
- The observed highlight has `id`, `category`, `parent`, `children`, `content`, `html`, `markdown`, `location`, `offset`, `tags`, `saved_at`, `saved_at_history`, `source`, `source_specific_data`, `parsed_doc_id`, and `updated`. This is an observed record, not a complete schema or a statement that all fields are required. The extension bundle's constructors are `j6` and `YJ`; selection conversion is `rh` (bundle lines 1897 and 1901).
- `content` holds the selected plain text; HTML and Markdown preserve selected formatting and links. Raw saved HTML in the observed extension-created highlight also contains source classes and an empty adjacent callout fragment. It should not be assumed to be a minimal or canonical article fragment.

### Anchor encoding and rendering

- `location` contains a serialized start and end separated by a comma. Each position encodes child-node indices separated by slashes, in leaf-to-root order, followed by a colon and offset. Selection serialization can join multiple ranges with `|`, but the inspected highlight restoration path reads only the first range. See `iC`, `NY`, `EHe`, `rC`, and `AY` (bundle line 188).
- Serialization accounts for Readwise's own highlight wrappers, adjacent split text, ignored whitespace, injected controls, and page-layout elements. This is a custom DOM serializer, not simply an unmodified DOM child-index path. Chunked content adds canonical-to-chunk conversion through `Em`, `Sm`, `oC`, and `Df` (line 188).
- Selection capture (`D6`, line 1894) saves the serialized location and a character offset. The offset comes from Rangy's `getBookmark().start`, relative to the document body for the non-chunked path. The chunked path sums preceding chunks' stored text-character counts and the position within the current chunk (`iXe`, `aXe`, and `oXe`, line 1896). It is a JavaScript string-length position, not a page number or guaranteed normalized-article offset.
- Rendering (`Fm`, line 1894) first calls `highlightLocation`, which deserializes the location and compares normalized range text to saved content. A mismatch or deserialization error triggers `highlightText`, which uses `jO` text search (line 188). Normalization collapses whitespace and handles some invisible characters; DRM-truncated content has a special prefix-match allowance.
- The inspected text-search fallback takes the first match found within its search range. It tolerates some whitespace differences and missing whitespace after periods, limits search size to 85,000 characters, and narrows large DOM ranges before searching. Its arguments contain neither the saved `offset` nor prefix/suffix context. Duplicate matches therefore have no explicit ambiguity resolution in this function. This is not evidence that every Readwise subsystem uses the same matching policy.
- `offset` is used in highlight merge ordering and EPUB chapter-context selection in inspected code (line 1897); it is not supplied to the inspected highlight restore/search path. Surrounding-text helpers exist, but their presence does not establish that surrounding context is persisted as an anchor selector.
- The render state includes non-rendered, render-in-progress, rendered, deserialization-failed, and unloaded-chunk states. Rendering creates multiple `rw-highlight` elements sharing one highlight ID when a logical selection crosses links or inline formatting.

### Cross-view evidence

- Two Reader-created highlights appeared on the original article with the same IDs and text; the note indicator also appeared. A new original-page highlight then appeared in Reader with the same ID, quote, and note relationship. Reader required a reload after becoming stuck on a loading screen, so immediate live synchronization was not established.
- The live state response for the original-page highlight retained a deep source DOM location and `offset: 320417`. Its actual canonical start in Reader was `0/14:0`. Resolving the stored source boundaries against Reader's DOM produced empty text. Together with the inspected restore code and successful visible rendering, this supports quote-search fallback as the cross-view bridge in this case; a rewritten Reader-specific anchor was not observed.
- The extension resolves an existing document by URL through `get_document`, retrieves that document and its descendants, and shares the underlying annotation IDs. Capture can submit page HTML through `get_or_add_document` or `add` (`lot`, `hot`, `mot`, and `xne`, bundle line 1950). Server URL normalization, extraction, and any other server-side remapping remain unknown.

### Implications to evaluate for Clipper

- Preserve one annotation identity across views while allowing distinct source-page and extracted-article selectors, each tied to a representation/version. Keep the quote and attached notes accessible even when an anchor cannot resolve.
- Evaluate DOM positions as a fast path and quote plus prefix/suffix and text position as fallback evidence. Repeated quotes should produce an explicit ambiguity outcome unless sufficient context distinguishes them. Do not infer that matching quote text alone proves the intended location.
- Keep content normalization and selector versioning explicit. Test selections crossing links, inline formatting, duplicate passages, extraction omissions, content changes, and incremental/chunk loading during the eventual anchoring spike.
- Remaining research: how Readwise presents unresolved highlights; whether other pipelines persist/remap additional anchor data; duplicate-quote behavior on controlled fixtures; server URL canonicalization and reparse behavior. These have not been established by the one-article walkthrough.

## W3C and Hypothesis reference research (2026-11-02)

### Live observation

The user created an annotation on [A List Apart's mobile-first CSS article](https://alistapart.com/article/mobile-first-css-is-it-time-for-a-rethink/). The installed Hypothesis sidebar reported version `1.1769.0`. Read-only inspection of the highlighted element's client annotation object found `target[].source` plus these selectors:

| Selector | Observed fields |
| --- | --- |
| `RangeSelector` | `startContainer` and `endContainer` were the same XPath ending in `/article[1]/div[1]/p[3]`; `startOffset: 206`, `endOffset: 389` |
| `TextPositionSelector` | `start: 2009`, `end: 2192` |
| `TextQuoteSelector` | A 183-character `exact` quote, with 32-character `prefix` and `suffix` |

Slicing the live body's `textContent` at those positions reproduced the quote. The rendered annotation had `$orphan: false`. This establishes the client target shape and successful anchoring on this page; the guest-side object omitted persisted ID and note-body fields, so it is not evidence of the full stored record. Private annotation retrieval was not established. Other older highlights were also present, including overlapping ranges.

### Standard versus implementation

W3C defines quote selectors with exact text and optional surrounding context, and position selectors with inclusive start and exclusive end. It requires normalized text and Unicode code-point counting. A quote that still has multiple matches after context processing should match all occurrences. Its `RangeSelector` uses `startSelector`/`endSelector`; refinement narrows an earlier selection, and state identifies the intended source representation. These are interchange semantics, not a prescribed fallback algorithm. [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)

Hypothesis's API types instead explicitly define text positions as UTF-16 offsets in body `textContent`, and its range selector uses XPath container strings plus offsets. Consequently, reusing these type names alone does not make that wire format identical to W3C's. Import/export needs explicit conversion, especially for supplementary Unicode characters. [Hypothesis API types](https://github.com/hypothesis/client/blob/main/src/types/api.ts)

### Current source anchoring behavior

The inspected repository `main` is a moving reference, not a verified match to the installed extension build. Its HTML resolver tries a DOM range, then text positions, then quote search. Range and position results must equal the stored quote when one exists. The position start is also passed as a hint for quote matching. Description generates the available selectors together. [HTML anchoring](https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/html.ts)

Quote capture takes 32 characters of surrounding context. Current quote handling substitutes spaces for `<br>` elements and translates resulting positions back to raw text offsets. This distinction reinforces the need for an explicit normalization contract rather than treating every string coordinate system as interchangeable. [Anchor types](https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/types.ts), [rendered-text mapping](https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/rendered-text.ts)

Quote search considers exact occurrences first, then approximate matches if none exist. Candidates are ranked by quote similarity, prefix/suffix similarity, and distance from the position hint, weighted 50/20/20/2. The inspected function returns the highest-ranked candidate without an explicit minimum final score or ambiguity-margin check, despite a comment mentioning a quality threshold. Therefore contextual matching improves candidate selection but does not guarantee rejection of a misleading match. [Quote matcher](https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/match-quote.ts)

### Accepted direction and remaining planning decisions

The user accepted W3C-compatible selectors, separate anchors per representation/version under one annotation ID, and explicit ambiguous/unresolved states. Source-page offsets must not be applied directly to extracted-article text; preserve the original selectors when deriving another anchor. The approved scope reduction defers candidate-confirmation screens and approximate matching; future candidates still require confirmation, including a single approximate candidate. MVP preserves honest resolution status and original context. Planning must define normalization, internal offset units, and selector versioning; candidate-generation thresholds are future work. Full import/export is deferred; future interchange must account for offset-unit conversion.

The next anchoring spike should compare duplicate quotes, changed quotes, inserted content, emoji, line breaks, and source-to-extracted text differences. No controlled mutation experiment or implementation has been performed in this research pass.

## Duplicate clipping and article updates: decisions and remaining planning questions

### Reference evidence

Readwise's current parsing FAQ documents URL-based duplicate detection: saving an identical URL reuses the entry and moves it to the top of the library. Different URLs, including tracking-parameter variants, can create duplicates. It describes saved articles as snapshots and says obtaining an updated article requires deleting and re-saving it, which also removes annotations. These are documented user-facing behaviors, not a verified account-wide backend contract. [Readwise parsing FAQ](https://docs.readwise.io/reader/docs/faqs/parsing)

The supplied extension bundle returns `wasAlreadySaved`, reuses the current ID for a re-save, and can display an already-saved message (`xne` and the injection save handler, lines 1950–1951). It also detects `source_specific_data.reparsed_at` updates and reloads content (`w5e`, `G5e`, line 141). The earlier live article response contained that timestamp. Thus the docs' snapshot description must not be interpreted as evidence that server-triggered reparsing never happens. Server refresh policy, previous-version retention, and annotation migration remain unverified. No destructive refresh experiment was performed.

### Current MVP behavior after scope reduction

| Situation | Launch outcome |
| --- | --- |
| First successful clip | Save a stable library document and its readable snapshot. |
| Re-clip an already-saved source | Show Already saved and offer Open. Preserve content, status, progress, annotations, and tags. |
| Clip a source already in Trash | Offer Restore without a duplicate or automatic restoration. |
| Failed initial capture | Retain a link-only entry, provenance, useful failure reason, and Retry. |
| Annotation fails to map between source and reader | Preserve quote, notes, original selectors, and context; report unresolved/ambiguous status without guessing. No repair screen is required. |
| Image processing pending | Make saved text readable while images process. |

### Deferred refresh design intent

The earlier refresh decisions remain future design intent: refresh is explicit; changed content creates and opens a new revision; unchanged content reports Already up to date; annotated old revisions/assets remain available; original anchors are preserved; ambiguous/approximate candidates require confirmation; equivalent reading positions are restored only when confidently mapped, otherwise reading starts at the beginning; article-level notes remain attached to the stable document. Failures never replace readable saved content. These behaviors are not launch implementation requirements.

No general version-history or diff viewer was selected. Historical retention, revision-equivalence rules, migration confidence, and reconnect conflicts should be resolved when refresh enters scope.

### Identity and implementation questions

- Redirect/short-link handling is a confirmed requirement from user review: an Add Link URL may not be the article's final or canonical URL. Preserve the submitted URL, observed redirect chain, final destination, and declared canonical candidate separately. Resolve before the authoritative duplicate check when online; treat unresolved intake as a pending capture rather than proof of a distinct article.
- Keep document identity independent of its URL and content hash. Track accepted aliases and the evidence/time supporting them; distinguish these from observed URLs. A shortening service can reuse a URL or change its destination, so a historical redirect must not permanently establish equivalence for every future capture. Identical text at different URLs is not alone proof of one source.
- After resolution, compare the validated destination and accepted canonical identity with existing documents. If a pending short-link capture resolves to an existing article, associate the capture with that document and preserve any provisional annotations or capture data when reconciling it. Redirect completion must not silently discard work.
- Define URL normalization conservatively. Unknown query parameters and route fragments can affect content; publisher canonical declarations may be incorrect or point to another origin. Resolve relative canonical candidates against the correct page base and validate their relevance before accepting them. Evaluate a known tracking-parameter policy rather than removing all queries/fragments.
- Resolve redirects with bounded hops, loop detection, timeouts, and recoverable failures. Some destinations require browser/session context or client-side navigation; use browser-observed destinations where available and report when resolution is incomplete. The fetch architecture, CORS constraints, and cross-origin canonical-validation policy remain planning decisions.
- Keep source capture (attempt, provenance, outcome), saved representation (readable snapshot), and annotation anchor (representation/selector version plus selectors) distinct. Version identifiers leave room for later refresh without requiring revision-management workflows in MVP.
- Future refresh planning must define content-equivalence hashing after extraction/normalization. MVP must still version selector normalization because parser changes can affect coordinates.
- Resolve simultaneous clipping from extension and PWA during Jazz planning, preserving annotations and successful captures. Concurrent refresh and current-revision selection are deferred with refresh.

Launch requirements include snapshot-preserving duplicate saves (FR-018), redirects/short links (FR-002), and honest anchor outcomes (FR-008). FR-019–FR-023 retain deferred refresh/repair design intent; they do not require those workflows for MVP.
