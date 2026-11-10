# Scoped account transport implementation

Production application account storage now uses the scoped DLF channel and a
Worker account-store owner. Broker migration remains follow-up work.

## Ownership and invocation

Solid edges describe actor ownership. Dotted edges describe API, native message or
receipt coordination. The SDK boundary and detached-custody boundary label root
creation explicitly; keeper roots deliberately survive forced account-owner stop.

```mermaid
flowchart TD
    Boot[Worker INITIALIZE boundary] -. creates root .-> Account[Account-store owner]
    Boot -. creates root .-> Channel[DLF scoped channel]
    SDK[SDK account.update API] -. START with operation ID .-> Account
    Account -->|spawn at most eight| Update[Account update machine]
    Update -->|invoke| Lock[Native Web Lock adapter]
    Update -->|invoke read / one write| IO[Selected storage operation]
    Update -->|invoke after uncertain write| Drain[DLF original-effect drain]
    IO -. REQUEST .-> Channel
    Channel -->|invoke| Controller[Private channel controller]
    Controller -->|spawn at most eight| Request[DLF request owner]
    Controller -->|invoke| Data[Native data listener]
    Controller -->|invoke| Control[Independent control listener]
    Request -->|invoke once| Post[Native data post]
    Post -. scoped READ / WRITE .-> Window[Window synchronous storage host]
    Window -. reply .-> Data
    Controller -. CLOSE_HOST .-> Close[Window data-host disposer]
    Close -. exact HOST_CLOSED after disposal .-> Control
    Control -. original host-close receipt .-> Drain
    Lock -. stop / error transfers native capabilities .-> Recipient[Worker-realm custody boundary]
    Recipient -. creates finite root .-> Keeper[Account write-custody machine]
    Keeper -->|invoke| DetachedDrain[DLF original-effect drain]
    Keeper -->|invoke and await actual release| Release[Native lock release]
    Control -. original host-close receipt .-> DetachedDrain
    Recipient -. retained keeper count .-> Account
    Host[Application host machine] -->|invoke SDK close then account close| Shutdown[Shutdown operation]
    Shutdown -. SHUTDOWN .-> Account
    Account -. close after updates and keepers settle .-> Channel
    Account -. actual scoped closure proof .-> Shutdown
```

The SDK promise facade starts one account root at Worker initialization. It only
allocates operation identity and settles native observers; admission, transform,
write, failure, drain and shutdown decisions live in charts. The channel root is
also created once, never from an individual read/write leaf. Detached keeper roots
start only on native custody handoff, with result/error observation attached.
They cannot be children of the stopped account owner because their lifetime must
continue. A keeper retains the original operation/scope and native receipts;
it cannot read another account, transform data or issue another write.

## Account update and shutdown

```mermaid
stateDiagram-v2
    [*] --> Acquiring
    Acquiring --> Reading: native lock granted
    Reading --> Transforming: original value
    Transforming --> Writing: original SDK transform
    Writing --> Releasing: acknowledged
    Writing --> Draining: unknown / timeout / shutdown
    Acquiring --> Releasing: failure / cancel queued acquisition
    Reading --> Releasing: failure / shutdown
    Transforming --> Releasing: failure
    Writing --> Releasing: proven not issued
    Draining --> Releasing: original effect or exact host-close proof
    Draining --> Draining: overdue / no proof
    Releasing --> Releasing: overdue / missing native release receipt
    Releasing --> [*]: actual native release
```

Unknown output settles the SDK observer once and retains custody. Late proof
permits release but never changes that failed result or replays the transform.
A known write acknowledgement stays acknowledged if release becomes overdue.
Before-write failures remain not-issued. Success requires the native lock request
promise to settle after release, rather than merely calling a release function.
The owner rejects new updates after shutdown and waits for both update children
and detached keepers before requesting exact channel/host closure. The application
host awaits SDK closure and this account-store closure before emitting `CLOSED`.

Deadlines are named, injectable chart policies: the account owner defaults to
10 seconds per lock/read/write/release wait; the scoped channel retains its
10-second request/close policy. These bound local native/IPC feedback, not remote
synchronization. They report overdue and retain issued-effect custody. No timeout
claims rejection, safe replay, successful shutdown or native release.

## Native state outside charts

The Window host validates strict bounded wire schemas, immutable scope and exact
FIFO sequence before synchronous `getItem`/`setItem` at the selected existing key.
Its close-control listener exists before key binding; close-before-binding prevents
later resurrection. Data handlers are disposed before a host-close receipt.
Post failure disposes the data host without replaying the primitive.

Native disposed flags, sequence counters, MessagePorts, promise resolvers,
subscription collections and Web Lock release gates remain adapter resources.
The native write ledger records only original receipts, outcomes and custody
handoff. It registers before issuing the write, revokes late orphaned I/O and
permits only one handoff. Immutable machine context holds workflow facts.
Native bookkeeping does not choose a storage namespace, SDK transform, retry or
account transition. All domain and Jazz work remains in the Worker.

Forced `dispose()` fails pending observers and rejects clean closure. It does not
stop detached keepers or treat actor termination as proof. Window hard teardown
disposes its native data hosts before terminating the Worker. An unobservable
receipt or failed keeper remains blocked; no synthetic completion clears custody.

## Qualification and remaining work

Native tests cover actual Web Lock serialization, queued cancellation, capacity,
read/transform failures, not-issued writes, dropped acknowledgement, late proof,
release failure/timeout, forced stop, child failure, revoked late I/O and reentrant
stop during posting. Chromium tests combine the real account facade, Workers,
MessageChannels, localStorage and Web Locks: a dropped WRITE reply retains the
lock past timeout and a competing operation stays blocked until matching closure
proof. Wrong close IDs cannot release it. The forced-owner-stop variant proves
custody survives independently without claiming clean owner closure.

See the [checkpoint record](workflow-hardening-progress.md#checkpoint-qualification)
for final regression counts and archive provenance. Both consumers use DLF source
`1571ba2`; all native alpha.60 module bytes and existing patches are preserved.
Web v2 and extension v1 keys/locks remain unchanged.

Broker routing is unchanged. Its scoped-channel migration, transferred-port cases,
Finance adoption and the rest of change sets C–G remain open. The legacy account
owner remains for compatibility fixtures and must not be supplied the new scoped
transport: its old write-error release path does not implement this custody contract.
