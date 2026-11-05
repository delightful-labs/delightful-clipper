# Bounded library organization

PR #13 merged at `2cd8731`; the user verified extension sign-in and saving into the web library. This batch adds Inbox (default), Later, Archive and an independent favorite flag. Bulk actions, tags, Trash, search, images and annotations remain excluded.

## Ownership and states before I/O

The application library owns a separate organization region alongside capture/reading. Idle admits one validated desired-value command for a visible library article. Writing owns one child until local settlement; shutdown disables admission and sends SHUTDOWN but retains that child until it drains. Closing joins organization, capture and worker drain. Issued unknown writes are never replayed. Local save and global acceptance are separate, observed with the existing receipt owner. Stale-account completions cannot publish presentation.

The child transaction uses DLF workspace-creation ownership: open → read parent and existing field operations → assess eligibility → stage one immutable operation → commit → wait local → release. Domain validation uses Zod and named predicates; no async leaf selects a subsequent workflow. Scope admission/commit checks reuse transactionLifecycle. No identity, recovery, reader or extension workflow is replaced.

## Native representation

Completed article/content rows remain immutable. A new owner-scoped native organizationOperations table contains a desired status or favorite value, an operation UUID, article ID and the observed causal parent UUIDs for that field. Each command reads and stages inside one native transaction. Projection excludes superseded operations and resolves concurrent heads by UUID order. Status and favorite have separate causal heads, so changing either never overwrites the other. No timestamps, toggle replay, local journal or second storage engine are used. Existing and link-only articles default to Inbox/unfavorited; pre-article legacy document rows can also be organized without rewriting content. Projection joins aliases for the same content, and transaction reads include their causal field heads so pending-article organization survives reconciliation.

Views select All/Inbox/Later/Archive, with Favorites as an independent AND filter. Organization never changes original save ordering or reader navigation. Collection ownership includes the native operation subscription. The immutable history is retained; compaction and large-library throughput are outside this bounded batch and are not claimed.

## Localization

The user explicitly approved all nine proposed library view/action/status/filtered-empty catalog entries with “yes” in this conversation. No interpolation or plural forms were added. Existing capture local-save/sync/error wording is reused by the owning machine.
