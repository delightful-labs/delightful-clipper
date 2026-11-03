# Tooling

The workspace includes a client-rendered account and private-library foundation. Capture, extensions, service workers, reader features remain separate work. Agent development and Netlify Jazz deployment hooks are configured below.

## Runtime and packages

Use pnpm 10.22.0 (`packageManager` in the root manifest). Its package-manager version management selects that version; Corepack is not required. The workspace's `useNodeVersion` runs project commands with Node 24.22.2 without changing the global Node installation. `.node-version` and CI use the same exact version. pnpm may download these tools on first use. See [pnpm's runtime settings](https://pnpm.io/10.x/settings#usenodeversion).

Direct dependencies are exact pins; commit `pnpm-lock.yaml` and use `pnpm install --frozen-lockfile` in CI. The installed baseline is Svelte 5.57.2, SvelteKit 3.0.1, Vite 8.3.4, TypeScript 6.0.3, XState 5.33.2 and Jazz 2.0.0-alpha.59. SvelteKit configuration lives in `apps/web/vite.config.ts`, as required by [Kit 3](https://svelte.dev/docs/kit/migrating-to-sveltekit-3).

DLF and DUI are checked-in private archives under `vendor/`. `manifest.json` records SHA-256 digests; the lockfile also records package integrity. The preinstall script verifies the archives. `verify:vendor` additionally loads DLF's public Jazz adapter exports and resolves DUI's package/theme entry points without starting a session. DLF is built from main commit `0582a9a5d7bc2cd56f52172ec5c1ca9213674056`; its empty root barrel is not a usable integration API. Clipper composes its public startup registry, session attachment, readiness and restoration workflows. These checks establish packaging compatibility, not a finished identity or storage integration.

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

The build emits the Jazz WASM asset and passes its bundled URL to the runtime. The app distinguishes local root persistence from remote acceptance. This proves cached account/root behavior while the authority is unavailable; it does not provide an offline app shell or article availability. See the [session implementation](../specs/001-jazz-clipper/session-implementation.md) for ownership and failure behavior.

## Agent development and qualification

`pnpm dev:agent` uses agent Vite mode, a separate fixed Jazz app ID and in-memory authority. It serves Clipper's actual schema and permissions with the inspector disabled. Ports fail when occupied; stop the agent server before running browser tests, which also use 5180/5181. Use a separate browser profile for agent work; the Jazz data is discarded when the server exits. Ordinary `pnpm dev` keeps its stable 5173/5174 identity scope.

Qualification: `pnpm verify` passes, including preview state-machine cancellation, bounded readiness, failure and credential-boundary tests. Chromium created an account and synced its private library through the actual agent server. A live disposable preview build provisioned Jazz app `68aed7eb-068f-4518-a90e-31ee27d6bf3c`, observed cold routing (503 then 200), deployed Clipper's real schema/policies and completed the Netlify adapter build. This validates the build entry point locally; Netlify-hosted execution is checked by the PR deploy preview when hosting is connected.

After integrating PR #5, combined validation passed: `pnpm verify` (67 unit tests and the production build) and all five Chromium tests, including native-byte offline restart/sync and gateway authentication.

## Public-source gateway qualification

The resolve/extract routes require the existing Jazz account plus `CAPTURE_GATEWAY_ENABLED=true` at build time. The default is false until hosted Netlify native/network qualification is completed. In local agent mode, run `CAPTURE_GATEWAY_ENABLED=true pnpm dev:agent`; Vite selects the isolated app ID and matching canonical registry explicitly so a normal-development `.env` cannot select the wrong namespace. Tests enable the routes against their disposable authority. See [gateway implementation](../specs/001-jazz-clipper/gateway-implementation.md) for bounds, evidence and the remaining hosted gate. This work does not enable Add Link or automatically save extracted content.

The deploy-preview context enables the gateway only against its generated disposable Jazz app for hosted qualification. Production keeps the default disabled flag. On 2026-11-03, production deploy `6ae9d9bec3d9d9edb3d5e0d0` was marked ready but served 404 because no functions were deployed. Netlify's actual Frameworks API loader reproduced the mismatch: base `apps/web` + package `apps/web` found no config; base `.` + package `apps/web` found the generated config. The root-base configuration fixes that discovery path without modifying site settings.

The web package directly declares the pinned `jazz-napi` server runtime, and Netlify retains it as an external Node module so its platform-specific native loader/dependency layout survives function bundling. The first root-base preview deployed the SvelteKit function but exposed `ERR_MODULE_NOT_FOUND: jazz-napi`; hosted invocation, not just a successful build, is required to qualify this boundary.

The native wrapper also ships binaries for every platform inline (about 400 MB total). Netlify's function bundle excludes Darwin, Windows and Linux arm64 native binaries, retaining the original Linux x64 GNU binary and its metadata for Netlify's x64 runtime. This avoids the 250 MB uncompressed function limit without changing installed package contents or native artifacts. The first external-module preview exceeded that limit before these exclusions.

Netlify's tracer also copies pnpm's hidden `.pnpm` paths; generic `**` exclusions do not match that hidden directory. Explicit `.pnpm` exclusions remove foreign binaries and redundant optional-package copies while preserving the inline Linux x64 GNU binary. Running Netlify's actual zip-it-and-ship-it bundler against the generated function produced a 531 MB unfiltered artifact and a 114 MB filtered artifact containing exactly one `.node` file (Linux x64 GNU).
