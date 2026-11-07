# Article-list filter popovers

The article-list heading has two right-aligned icon buttons, following Finance PR #58: Search articles opens the existing search field; Filter articles opens the existing status, favorites and tag controls. DUI owns the native auto popovers, buttons, icons and accessible hidden labels. Clipper adds structural layout and keyboard/focus handling.

The library actor continues owning queries, filter selections and search-worker feedback. Dismissing either popover does not reset those values. Escape prevents the search field's native clearing behavior, closes the active popover and returns focus to its trigger. Opening search focuses its field; opening filters focuses the selected status radio. Search failure and retry remain visible outside the popover. Browser light dismissal and mutual exclusion use the native auto-popover behavior.

The user explicitly approved `actions.filter_subject`, “Filter {{subject}}”, rendered with the existing plural article noun as “Filter articles”. Existing `actions.search_subject` supplies “Search articles”. No dependencies, nouns or other catalog wording are added. Finance's date/category/currency domain filters are not copied into Clipper.

The branch starts at merged Clipper PR #19 (`ced036a`). Tests cover desktop/mobile keyboard access, dismissal, focus restoration, preserved search/status/favorite selections, combined tag filters, search retry and offline restart.

Validation: 643 unit/native tests pass (one Linux-only test skipped on macOS), all 61 application browser cases pass across the main and isolated upgrade runs, five production offline tests pass, and both sample-data browser tests pass. Desktop/mobile focus checks also pass after the final selected-radio adjustment. Existing development services are preserved; temporary test copies change only isolated ports and the upgrade driver endpoint, and are removed after qualification.

The final production restart fixture had one article-extraction timeout before the filter controls were used; its focused trace rerun passed. The remaining four offline cases passed in the full run.

CI follow-up: the first account reload raced a Vite full-page reload on a cold dependency cache. Optimizer diagnostics identified late discovery of `minisearch` when the search worker starts after account readiness. Explicit prebundling prevents that reload, and the account test now rejects unexpected dev-server reload events. Three separate cold-cache starts pass with no reload events; no retries or timeout increases were added.
