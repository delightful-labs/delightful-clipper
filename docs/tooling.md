# Tooling

The workspace includes a client-rendered account and private-library foundation. Capture, extensions, service workers, reader features remain separate work. Agent development and Netlify Jazz deployment hooks are configured below.

## Runtime and packages

Use pnpm 10.22.0 (`packageManager` in the root manifest). Its package-manager version management selects that version; Corepack is not required. The workspace's `useNodeVersion` runs project commands with Node 24.22.2 without changing the global Node installation. `.node-version` and CI use the same exact version. pnpm may download these tools on first use. See [pnpm's runtime settings](https://pnpm.io/10.x/settings#usenodeversion).

Direct dependencies are exact pins; commit `pnpm-lock.yaml` and use `pnpm install --frozen-lockfile` in CI. The installed baseline is Svelte 5.57.2, SvelteKit 3.0.1, Vite 8.3.4, TypeScript 6.0.3, XState 5.33.2 and Jazz 2.0.0-alpha.59. SvelteKit configuration lives in `apps/web/vite.config.ts`, as required by [Kit 3](https://svelte.dev/docs/kit/migrating-to-sveltekit-3).

DLF and DUI are checked-in private archives under `vendor/`. `manifest.json` records SHA-256 digests; the lockfile also records package integrity. The preinstall script verifies the archives. `verify:vendor` additionally loads DLF's public Jazz adapter exports and resolves DUI's package/theme entry points without starting a session. DLF uses the `aaf718d-logger` archive already consumed by Finance, including the public `diagnostics/logger` export; its empty root barrel is not a usable integration API. Clipper composes its public startup registry, session attachment, readiness and restoration workflows. These checks establish packaging compatibility, not a finished identity or storage integration.

Only esbuild's dependency lifecycle script is allowed. protobufjs's postinstall only checks dependency-version notation; it is deliberately skipped. Do not enable every dependency build script as a workaround.

## Commands

Run from the repository root:

| Command                             | Purpose                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm install`                      | Install and update the lockfile intentionally.                                                 |
| `pnpm install --frozen-lockfile`    | Reproduce committed dependencies.                                                              |
| `pnpm dev`                          | Web dev server at http://127.0.0.1:5173; fail if the port is occupied.                         |
| `pnpm dev:agent`                    | Isolated agent web server on 5180 and disposable in-memory Jazz on 5181.                       |
| `pnpm deploy:jazz`                  | Deploy Clipper schema/policies to explicitly configured Jazz service.                          |
| `pnpm build:deploy-preview`         | Netlify deploy-preview only: provision disposable Jazz, deploy, then build.                    |
| `pnpm preview`                      | Preview the production build at http://127.0.0.1:4173.                                         |
| `pnpm check`                        | Strict checking of tooling JS and Svelte/TypeScript web sources, including Vite configuration. |
| `pnpm lint`                         | Oxlint correctness and strict TypeScript rules for supported JS/TS files.                      |
| `pnpm format` / `pnpm format:check` | Oxfmt write/check; existing specification documents and generated/vendor files are excluded.   |
| `pnpm verify:vendor`                | Archive digest and installed entry-point checks.                                               |
| `pnpm build`                        | Production build with the Netlify adapter.                                                     |
| `pnpm verify`                       | Vendor, format, lint, type/Svelte checks, unit/policy tests and build.                         |

Oxlint is not claimed to lint Svelte templates; `svelte-check` and the Svelte compiler cover those components. Run `pnpm test:unit` for coordinator lifecycle and native authorization tests. Run `pnpm exec playwright install chromium` once, then `pnpm test:e2e` for account creation, reload, recovery identity equality, authority disconnection/reconnection and a cold browser-process restart with the authority offline (web shell remains reachable). Browser tests use synthetic accounts, a disposable authority and separate browser profiles; recovery traces/screenshots are disabled.

## Workspace and CI

`apps/web` owns the web build. `apps/*` and `packages/*` are workspace locations; do not create empty domain packages or extension stubs merely to fill the planned directory tree. Add shared packages when there is implementation to own.

GitHub Actions runs a frozen install and `pnpm verify` for PRs and main, with Node/pnpm pinned and read-only repository permissions. Action revisions are pinned to verified upstream commits. No production credentials are needed. Tests start disposable local Jazz authorities; the browser job installs Chromium. A separate `Conventional PR title` check validates `type(scope): description` on PR opening, title edits and subsequent updates, matching the sibling repositories. Scope is optional; breaking changes may use `!` before the colon.

Netlify uses the repository root as its build base, `apps/web` as its site package directory, and `apps/web/build` as the publish directory. Root commands forward to the web package. This makes Netlify discover the adapter's generated `apps/web/.netlify/v1` output once; using both `apps/web` as the base and package directory incorrectly searches under `apps/web/apps/web`. The package directory is configured on the Netlify site. `NODE_VERSION` and `PNPM_VERSION` match local/CI pins. The local build verifies adapter output, not a deployed preview, native gateway packaging or destination-safe network transport. Production builds run `pnpm deploy:jazz && pnpm build`; a failed deployment stops the build. Configure production-context `PUBLIC_JAZZ_APP_ID`, `PUBLIC_JAZZ_SERVER_URL` and build-only `JAZZ_ADMIN_SECRET` in Netlify. The CLI accepts the public coordinates; if `JAZZ_APP_ID`/`JAZZ_SERVER_URL` are also set, they must identify the same app.

Deploy previews run `pnpm build:deploy-preview`. Each build provisions one disposable Jazz app, waits for cold routing with at most 12 checks separated by five seconds, publishes Clipper's schema/policies, then builds against the generated coordinates. No shared production app is used on failure. Provisioning itself is not retried. Generated admin credentials are only passed to the deploy subprocess and cleared before the frontend build; inherited admin/backend secrets are removed from the build environment. Cancellation aborts the current request/process group and waits for settlement. Disposable apps expire after 14 days; each preview rebuild gets a new app and therefore a separate identity/data scope.

Preview builds override `PUBLIC_JAZZ_APP_ID`, `PUBLIC_JAZZ_SERVER_URL`, CLI coordinates and `JAZZ_ACCOUNT_REGISTRY` for the generated app. The gateway hook reads the registry as a server-only static build variable, so a preview uses its generated registry even when the function runtime has no corresponding environment override. It is a service coordinate, not a credential. Production builds require separately provisioned service credentials; neither local dev nor CI needs production credentials. Branch deploys retain the default build command and need explicit service configuration; disposable provisioning is restricted to Netlify's `deploy-preview` context.

## Account service configuration

`pnpm dev` starts the local Jazz authority on port 5174 and the web app on 5173. Development uses the production library schema and permissions, with inspector disabled. Checks/builds do not start the authority.

Production requires `PUBLIC_JAZZ_APP_ID` and `PUBLIC_JAZZ_SERVER_URL` at build time. These are public service coordinates, not administrator credentials. Without them the app displays a configuration status. Deploy the schema/policies to the intended Jazz service using `pnpm --filter @delightful-clipper/web deploy:jazz` with separately provisioned Jazz deployment credentials. Netlify production and preview hooks invoke this deployment command automatically.

The build emits the Jazz WASM asset and passes its bundled URL to the runtime. The app distinguishes local root persistence from remote acceptance. Production offline shell and saved article restart evidence are recorded separately in the offline-shell implementation and current tasks. See the [session implementation](../specs/001-jazz-clipper/session-implementation.md) for ownership and failure behavior.

## Agent development and qualification

`pnpm dev:agent` uses agent Vite mode, a separate fixed Jazz app ID and in-memory authority. It serves Clipper's actual schema and permissions with the inspector disabled. Ports fail when occupied; stop the agent server before running browser tests, which also use 5180/5181. Use a separate browser profile for agent work; the Jazz data is discarded when the server exits. Ordinary `pnpm dev` keeps its stable 5173/5174 identity scope.

Qualification: `pnpm verify` passes, including preview state-machine cancellation, bounded readiness, failure and credential-boundary tests. Chromium created an account and synced its private library through the actual agent server. A live disposable preview build provisioned Jazz app `68aed7eb-068f-4518-a90e-31ee27d6bf3c`, observed cold routing (503 then 200), deployed Clipper's real schema/policies and completed the Netlify adapter build. This validates the build entry point locally; Netlify-hosted execution is checked by the PR deploy preview when hosting is connected.

After integrating PR #5, combined validation passed: `pnpm verify` (67 unit tests and the production build) and all five Chromium tests, including native-byte offline restart/sync and gateway authentication.

## Public-source gateway qualification

The resolve/extract routes require the existing Jazz account plus `CAPTURE_GATEWAY_ENABLED=true` at build time. The default is false until hosted Netlify native/network qualification is completed. In local agent mode, run `CAPTURE_GATEWAY_ENABLED=true pnpm dev:agent`; Vite selects the isolated app ID and matching canonical registry explicitly so a normal-development `.env` cannot select the wrong namespace. Tests enable the routes against their disposable authority. See [gateway implementation](../specs/001-jazz-clipper/gateway-implementation.md) for bounds, evidence and the remaining hosted gate. The Add Link batch consumes these endpoints through a runtime-owned workflow; one Add Link submission automatically saves usable extracted content.

The deploy-preview context enables the gateway only against its generated disposable Jazz app for hosted qualification. Production keeps the default disabled flag. On 2026-11-03, production deploy `6ae9d9bec3d9d9edb3d5e0d0` was marked ready but served 404 because no functions were deployed. Netlify's actual Frameworks API loader reproduced the mismatch: base `apps/web` + package `apps/web` found no config; base `.` + package `apps/web` found the generated config. The root-base configuration fixes that discovery path without modifying site settings.

The web package directly declares the pinned `jazz-napi` server runtime, and Netlify retains it as an external Node module so its platform-specific native loader/dependency layout survives function bundling. The first root-base preview deployed the SvelteKit function but exposed `ERR_MODULE_NOT_FOUND: jazz-napi`; hosted invocation, not just a successful build, is required to qualify this boundary.

The native wrapper also ships binaries for every platform inline (about 400 MB total). Netlify's function bundle excludes Darwin, Windows and Linux arm64 native binaries, retaining the original Linux x64 GNU binary and its metadata for Netlify's x64 runtime. This avoids the 250 MB uncompressed function limit without changing installed package contents or native artifacts. The first external-module preview exceeded that limit before these exclusions.

Netlify's tracer also copies pnpm's hidden `.pnpm` paths; generic `**` exclusions do not match that hidden directory. Explicit `.pnpm` exclusions remove foreign binaries and redundant optional-package copies while preserving the inline Linux x64 GNU binary. Running Netlify's actual zip-it-and-ship-it bundler against the generated function produced a 531 MB unfiltered artifact and a 114 MB filtered artifact containing exactly one `.node` file (Linux x64 GNU).

AWS Lambda disables synchronous require-of-ESM even on Node 24; jsdom 29's CommonJS encoding dependency requires that interop. The user configured `NODE_OPTIONS=--experimental-require-module`, and the CLI confirmed it in preview/functions scope, but hosted diagnostics showed an explicit `--no-experimental-require-module` process argument overriding it. Extraction now runs in a dedicated worker with explicit `execArgv`, a 10-second deadline, 128 MB old-generation limit, cancellation and termination awaited through exit. A global four-request admission bound complements the per-account limit. The worker bundle and parser dependencies are explicitly included in the Netlify function. Production gateway enablement remains separate. See [AWS runtime behavior](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html#nodejs-experimental-features).

PR #8 verification: `pnpm verify` passes with 125 unit tests. A compiled worker invocation succeeds under a parent started with `--no-experimental-require-module`. Hosted immutable deploy `6ae9edae53bcb3fbcca24232` (commit `375ee22`) passes authenticated extraction and resolution (200), direct loopback/metadata rejection (400), public redirect resolution (200), and private/no-store response checks. All five browser tests and Linux CI pass. Earlier hosted previews proved shell/account/private-root sync, signed public URL resolution, direct private-address rejection and public redirects; extraction returned retryable 503 under the parent runtime. Deterministic local private-redirect revalidation tests pass; a hosted private-redirect fixture remains unqualified. Production is not updated until this PR is merged.

## Add Link development

With `CAPTURE_GATEWAY_ENABLED=true pnpm dev:agent`, open the local library directly and use Add Link → automatic save → Open saved article. The saved collection opens dedicated SvelteKit reader pages with sanitized structured HTML and literal-text fallback; source provenance remains in private native records. Existing final destinations show Already saved and preserve their snapshot. Canonical declarations remain unaccepted evidence. Unknown or stranded operations require checking existing content; the workflow never automatically replays their insert.

Production gateway enablement is still a separate deployment choice. The UI restart test stubs gateway responses but uses real Jazz persistence/sync and full Chromium process exit; it disconnects the authority before returning extraction so automatic saving completes locally. The production offline suite additionally stops both servers and clears HTTP cache before a full browser-process restart. Downloaded images remain unimplemented.

## Production offline qualification

Run `pnpm test:offline`. It builds two production versions under ignored `apps/web/.offline-test-builds`, then starts public static fixtures at `http://127.0.0.1:5190` and a real disposable Jazz authority at port 5191. The tests stop both servers, close/reopen an entire persistent Chromium process, clear its HTTP cache and read exact saved text before reconnecting and checking a separately restored profile. No credentials are printed or traced.

DLF's packaged startup/readiness/recovery and teardown behavior remains in use. The service worker stores only the prerendered root and build-listed public assets, excluding authenticated requests, gateway results and Jazz data. Updates wait for all old app tabs to close; there is no forced activation or reload. Failed installs discard their new cache and keep the old version usable. The build includes worker dependencies in SvelteKit's manifest and gives page/worker WASM the same immutable filename, avoiding the second binary. Startup and transfer observations are in the offline implementation evidence. Chromium qualification does not establish other browser/device support or immunity to site-data eviction.

First use follows Finance: DLF/Jazz startup receives `initial: 'local-first'` and silently initializes a local identity when needed. No signup or Create account interaction is required, including when the authority is unavailable. Existing local identities reopen; explicit sign-out allows optional restoration through the existing recovery workflow.

Local Vite uses `.svelte-kit/local`, agent Vite uses `.svelte-kit/agent`, and browser-test Vite uses `.svelte-kit/e2e`; production/sync output stays in `.svelte-kit`. This prevents a running developer server from importing a test-generated environment that points account verification at a stopped test authority. The first-party `/api/capture/*` SvelteKit routes run directly under Vite; Netlify function emulation is not required for Add Link. Real local extraction must be checked without gateway fixtures after test/build runs, in addition to the deterministic browser suite.

Automatic local identities do not show Sign out. Optional recovery-phrase restoration is available from the local library and drains issued library writes before the DLF restoration operation. Sign-out presentation requires an explicitly signed-in identity; this does not introduce a new sign-in provider flow.

Add Link immediately saves a native URL article. A dedicated module-worker machine fills missing content serially; the same save operation accepts supplied content. The earlier preview/Save step is removed; successful local save stays in the library with an explicit Open action. Network extraction still needs connectivity; local publication and pending remote acceptance remain separate.

Saved articles open as SvelteKit pages at `/articles/[id]`. The root layout owns the local-first runtime across library/reader navigation. Browser Back and normal new-tab links work; direct offline reader navigations use only the cached public shell while document reads remain owner scoped in Jazz.

Oxfmt explicitly enables Svelte formatting with `svelte: true` in `.oxfmtrc.json`. `pnpm format` formats component scripts, templates and embedded CSS; `pnpm format:check` checks them in the existing `pnpm verify` CI gate. Svelte support is opt-in in the pinned formatter and must not be disabled. Components use multiline CSS declarations and blank lines between rule blocks.

Schema changes must include the typed migrations and snapshots needed by existing persisted authorities/replicas. Fresh test authorities do not qualify upgrades. The URL-first migration connects persisted schema `9251313c0afe` to `80988faa7219` without resetting the library or immutable content. Jazz publishes the migration before advancing permissions; a missing migration can leave a hot-reloaded client querying a schema the authority has rejected. Check managed-server initialization/schema-push output after schema changes. Do not clear browser storage, rotate account IDs or delete the authority database as a migration workaround.

## Diagnostics

Clipper imports `createLogger` from `delightful-local-first/diagnostics/logger`. The host explicitly enables output only when `PUBLIC_DEBUG=true`; development mode alone does not enable it. Set that value in `apps/web/.env.local` and restart the dev server. It is currently enabled locally to investigate the persisted-library failure; the flag defaults to off in other builds. DLF owns scoped output, while Clipper owns the environment policy and its XState inspection adapter. The machine-failure adapter in Finance is Finance-owned, not a DLF export.

The application and offline-shell actor trees, dedicated article worker and separately owned worker-host storage actors use the observer. Browser-console messages have the `[clipper:machines]` prefix; Vite also forwards console errors to the server output. Diagnostics include modeled state paths, completion kind/outcome and sanitized error name/message/code/cause. They do not serialize input, context, event payloads, article content, account objects, recovery material or SDK configuration. Diagnostic sanitization is bounded and best-effort; callers must still select safe fields. No logging persistence or telemetry service is added.

The actual existing Firefox profile reports `Protocol: invalid stored value: durable catalogue must have exactly one genesis schema` in `root-bootstrap` during its read. Fresh profiles and the native upgrade regression do not reproduce that local catalogue state. The earlier `trim` exception was from `moz-extension://…/injection/index.js`. The migration correction did not repair this existing browser catalogue; preserve its data and investigate the native catalogue separately.
