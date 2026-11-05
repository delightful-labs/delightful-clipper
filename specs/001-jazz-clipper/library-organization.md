# Bounded library organization

PR #13 merged at `2cd8731`; the user verified extension sign-in and saving into the web library. This batch adds Inbox (default), Later, Archive and an independent favorite flag. Bulk actions, tags, Trash, search, images and annotations remain excluded.

## Ownership and states before I/O

The application library owns a separate organization region alongside capture/reading. Idle admits one validated desired-value command for a visible library article. Writing owns one child until local settlement; shutdown disables admission and sends SHUTDOWN but retains that child until it drains. Closing joins organization, capture and worker drain. Issued unknown writes are never replayed. Local save and global acceptance are separate, observed with the existing receipt owner. Stale-account completions cannot publish presentation.

The child first observes immutable field history in an explicit state. Its DLF workspace-creation transaction then owns open → read parent/aliases → assess eligibility → stage one immutable operation → commit → wait local → release. Domain validation uses Zod and named predicates; no async leaf selects a subsequent workflow. Scope admission/commit checks reuse transactionLifecycle. No identity, recovery, reader or extension workflow is replaced.

## Native representation

Completed article/content rows remain immutable. A new owner-scoped native organizationOperations table contains a desired status or favorite value, an operation UUID, exactly one native article/document parent reference and the observed causal parent UUIDs for that field. The staging chart selects the checked parent inside the owning transaction; native policies require that parent to belong to the same library. Each command checks mutable parent eligibility and stages inside one native transaction; immutable causal knowledge is observed before opening it. Projection excludes superseded operations and resolves concurrent heads by UUID order. Status and favorite have separate causal heads, so changing either never overwrites the other. No timestamps, toggle replay, local journal or second storage engine are used. Existing and link-only articles default to Inbox/unfavorited; pre-article legacy document rows can also be organized without rewriting content. Projection joins aliases for the same content, and transaction reads include their causal field heads so pending-article organization survives reconciliation.

Views select All/Inbox/Later/Archive, with Favorites as an independent AND filter. Organization never changes original save ordering or reader navigation. Collection ownership includes the native operation subscription. The immutable history is retained; compaction and large-library throughput are outside this bounded batch and are not claimed.

## Localization

The user explicitly approved all nine proposed library view/action/status/filtered-empty catalog entries with “yes” in this conversation. No interpolation or plural forms were added. Existing capture local-save/sync/error wording is reused by the owning machine.

## Browser transaction qualification correction

Native NAPI tests passed, but the actual browser's second status edit stalled. Isolated preview tracing localized the stall to `tx.all(organizationOperations.where(...))` with existing rows; the identical immutable-history query outside the transaction returned immediately. No user profile or private library was used for that investigation.

Model a history-observation state before transaction admission. It owns and drains a local-first read of immutable field operations, then passes that observed causal knowledge to the transaction draft. The transaction continues to own parent/alias reads, parent eligibility, native reference selection, staging and commit. Immutable operations cannot be changed/deleted between observation and staging; newly concurrent operations are intentionally resolved by the established concurrent-head rule. This does not move mutable parent checks out of their transaction, gate editing on connectivity, replay writes or introduce another storage protocol.

## Reader preservation

Collection updates must not restart an already issued reader read. The library statechart now guards automatic reopening with `not(readInFlight)`; explicit navigation still opens the selected reader, and content arriving for a missing link-only reader still triggers its initial successful read. A regression held the read while three favorite updates arrived: the old chart advanced generation from one to four. The corrected chart retains that generation and one read. This bounds the extra organization subscription's effect on existing cold-start/read ownership.
