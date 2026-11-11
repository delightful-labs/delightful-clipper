# Saved article metadata

The user approved retaining full excerpts, author, siteName, publishedTime, lang,
dir and featured images before implementation on 2026-11-10. Further schema or
migration scope changes must be explained and approved before they are applied.

Readability's title and the existing processed HTML/plain text behavior remain
unchanged. Its excerpt is saved in full, without display truncation, whitespace
normalization or title removal. If a capture supplies no excerpt, new saves use
the saved body text. Only worker projections shorten homepage previews (240
graphemes / 1 KiB), and the UI clamps them to three lines.

The canonical capture metadata contract is `capture/metadata.ts`. `byline` maps
to `author`; siteName, publishedTime, lang and dir retain the parser's values.
Publication time is a source string, separate from the clipping timestamp. Missing
metadata remains null. Retained text metadata and excerpts have a 1 MiB UTF-8
validation limit, aligned with the existing HTML budget; oversized input is
rejected, never silently truncated. Existing source, body and image bounds remain
in force.

Featured images are read before Readability mutates the document. The first
valid HTTP(S) `og:image` wins, then `twitter:image` / `twitter:image:src`, resolved
against the source base URL. Credentials and active URL schemes are rejected.
`featuredImageUrl` is retained on the snapshot. The featured URL is queued first
through the existing articleImages/assets workflow and deduplicated against inline
images, within the existing 250-image total. Raster bytes use the existing
validation, resizing, persistence, retries and account lifecycle. Image download
failure does not discard article content or its source image URL. The extension
saves pending image references; the web application's existing image queue downloads
them when that library is open, as it does for extension-captured inline images.

Extension serialization preserves meta tags and inert application/ld+json data
for worker-side Readability metadata extraction. Executable scripts, form inputs
and handlers remain excluded. No new page permissions or dependencies are needed.

The excerpt migration `7c74c142a5dc -> 5e70efdb5795` already ran in the local
preview before the metadata discussion. Keep it intact. The approved metadata
migration is a second additive edge, `5e70efdb5795 -> 8a4e11c993e0`, adding six
nullable snapshot strings with null defaults. It preserves existing snapshots,
bytes, identities and article dates. No bulk refetch or data backfill occurs.
Legacy articles can display previews derived from saved text without a write.

Qualification for this change: 689 unit/native tests; two desktop/mobile capture
cases inspecting full saved metadata and cached featured-image bytes; eight
Chromium/Firefox migration cases; eight production offline cases, including a
cold browser restart while both servers are stopped followed by native metadata
and featured-image asset inspection after reconciliation; and all 12 packaged
Chrome extension cases. The toolbar case inspects full metadata on the native
store after capture and verifies duplicate saves keep the original snapshot.
Extension test navigation now uses the existing account-page and article-popover
helpers. An initial extension attempt hit a test-server port teardown race; the
final isolated run passed. The local MCP preview retained its two existing
articles and showed no library error after the additive migrations.
