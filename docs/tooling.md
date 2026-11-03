# Tooling

The workspace includes a client-rendered account and private-library foundation. Capture, extensions, service workers, reader features and deployment remain separate work.

## Runtime and packages

Use pnpm 10.22.0 (`packageManager` in the root manifest). Its package-manager version management selects that version; Corepack is not required. The workspace's `useNodeVersion` runs project commands with Node 24.22.2 without changing the global Node installation. `.node-version` and CI use the same exact version. pnpm may download these tools on first use. See [pnpm's runtime settings](https://pnpm.io/10.x/settings#usenodeversion).

Direct dependencies are exact pins; commit `pnpm-lock.yaml` and use `pnpm install --frozen-lockfile` in CI. The installed baseline is Svelte 5.57.2, SvelteKit 3.0.1, Vite 8.3.4, TypeScript 6.0.3, XState 5.33.2 and Jazz 2.0.0-alpha.59. SvelteKit configuration lives in `apps/web/vite.config.ts`, as required by [Kit 3](https://svelte.dev/docs/kit/migrating-to-sveltekit-3).

DLF and DUI are checked-in private archives under `vendor/`. `manifest.json` records SHA-256 digests; the lockfile also records package integrity. The preinstall script verifies the archives. `verify:vendor` additionally loads DLF's public Jazz adapter exports and resolves DUI's package/theme entry points without starting a session. DLF's empty root barrel is not a usable integration API. These checks establish packaging compatibility, not a finished identity or storage integration.

Only esbuild's dependency lifecycle script is allowed. protobufjs's postinstall only checks dependency-version notation; it is deliberately skipped. Do not enable every dependency build script as a workaround.

## Commands

Run from the repository root:

| Command                             | Purpose                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm install`                      | Install and update the lockfile intentionally.                                                 |
| `pnpm install --frozen-lockfile`    | Reproduce committed dependencies.                                                              |
| `pnpm dev`                          | Web dev server at http://127.0.0.1:5173; fail if the port is occupied.                         |
| `pnpm preview`                      | Preview the production build at http://127.0.0.1:4173.                                         |
| `pnpm check`                        | Strict checking of tooling JS and Svelte/TypeScript web sources, including Vite configuration. |
| `pnpm lint`                         | Oxlint correctness and strict TypeScript rules for supported JS/TS files.                      |
| `pnpm format` / `pnpm format:check` | Oxfmt write/check; existing specification documents and generated/vendor files are excluded.   |
| `pnpm verify:vendor`                | Archive digest and installed entry-point checks.                                               |
| `pnpm build`                        | Production build with the Netlify adapter.                                                     |
| `pnpm verify`                       | Vendor, format, lint, type/Svelte checks, unit/policy tests and build.                         |

Oxlint is not claimed to lint Svelte templates; `svelte-check` and the Svelte compiler cover those components. Run `pnpm test:unit` for coordinator lifecycle and native authorization tests. Run `pnpm exec playwright install chromium` once, then `pnpm test:e2e` for account creation, reload, recovery and authority disconnection/reconnection. Browser tests use synthetic accounts, a disposable authority and separate browser profiles; recovery traces/screenshots are disabled.

## Workspace and CI

`apps/web` owns the web build. `apps/*` and `packages/*` are workspace locations; do not create empty domain packages or extension stubs merely to fill the planned directory tree. Add shared packages when there is implementation to own.

GitHub Actions runs a frozen install and `pnpm verify` for PRs and main, with Node/pnpm pinned and read-only repository permissions. Action revisions are pinned to verified upstream commits. No production credentials are needed. Tests start disposable local Jazz authorities; the browser job installs Chromium.

Netlify uses `apps/web` as its build base and `build` as the publish directory, matching the adapter's generated functions/config. `NODE_VERSION` and `PNPM_VERSION` match local/CI pins. The local build verifies adapter output, not a deployed preview, native gateway packaging or destination-safe network transport. No deployment command is part of this setup.

## Account service configuration

`pnpm dev` starts the local Jazz authority on port 5174 and the web app on 5173. Development uses the production library schema and permissions, with inspector disabled. Checks/builds do not start the authority.

Production requires `PUBLIC_JAZZ_APP_ID` and `PUBLIC_JAZZ_SERVER_URL` at build time. These are public service coordinates, not administrator credentials. Without them the app displays a configuration status. Deploy the schema/policies to the intended Jazz service using `pnpm --filter @delightful-clipper/web deploy:jazz` with separately provisioned Jazz deployment credentials. This repository change does not deploy a service.

The build emits the Jazz WASM asset and passes its bundled URL to the runtime. The app distinguishes local root persistence from remote acceptance. This proves cached account/root behavior while the authority is unavailable; it does not provide an offline app shell or article availability. See the [session implementation](../specs/001-jazz-clipper/session-implementation.md) for ownership and failure behavior.
