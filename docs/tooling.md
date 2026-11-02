# Tooling

The tooling PR establishes the workspace and a minimal client-rendered web shell. Identity, storage, capture, extensions, service workers, reader features and deployment remain separate work.

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
| `pnpm verify`                       | Vendor, format, lint, type/Svelte checks and build.                                            |

Oxlint is not claimed to lint Svelte templates; `svelte-check` and the Svelte compiler cover those components. There is no artificial passing test script: add meaningful unit/browser suites with the workflows they verify. This PR's shell can be checked manually in a browser.

## Workspace and CI

`apps/web` owns the web build. `apps/*` and `packages/*` are workspace locations; do not create empty domain packages or extension stubs merely to fill the planned directory tree. Add shared packages when there is implementation to own.

GitHub Actions runs a frozen install and `pnpm verify` for PRs and main, with Node/pnpm pinned and read-only repository permissions. Action revisions are pinned to verified upstream commits. No credentials or live Jazz server are needed for these tooling checks.

Netlify uses `apps/web` as its build base and `build` as the publish directory, matching the adapter's generated functions/config. `NODE_VERSION` and `PNPM_VERSION` match local/CI pins. The local build verifies adapter output, not a deployed preview, native gateway packaging or destination-safe network transport. No deployment command is part of this setup.
