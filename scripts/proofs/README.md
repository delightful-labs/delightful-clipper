# Isolated foundation qualification

`private-library.ts` is a disposable SDK qualification experiment. It is not production library creation, a DLF implementation, or an application migration. It starts a temporary local Jazz authority through the SDK's public testing helper, deploys only its synthetic three-table fixture, uses synthetic accounts, and shuts the fixture down in `finally`. No user account or production endpoint is used.

It checks authority-confirmed creation of library/operation rows, owner-only row and byte reads, rejected forged ownership/foreign references, whole-transaction rejection, and precommit rollback. It deliberately does not use admin seeding to establish the owner-created library. SDK test-helper assertions are unused; assertions use Node's standard library.

## Reproduction

Use a disposable directory containing a copy of `private-library.ts`, a `package.json` with `{"type":"module"}`, and a `node_modules` symlink to a qualified SDK dependency tree. Do not install dependencies into the legacy Clipper app for this proof. The dependency tree must contain `jazz-tools` 2.0.0-alpha.59, its native dependencies, TypeScript and Node types. Verify the SDK version before running.

From that disposable directory:

```sh
node node_modules/typescript/bin/tsc private-library.ts --noEmit --strict --skipLibCheck --target ES2023 --module NodeNext --types node
node private-library.ts
```

The runtime needs permission to bind a localhost listener. It does not require production credentials. Node must support running TypeScript with type stripping; the recorded experiment used Node 25.2.1, not the planned Node 24 qualification target. The strict check covers this experiment's source; `skipLibCheck` does not validate all dependency declarations.

The passing result is JSON with five scenario groups. A failure or unhandled exception is not a passed proof. Record actual runtime/SDK/compiler versions and output when rerunning. Do not treat a local authority/memory-client fixture as evidence of browser persistence, a deployed app schema, DLF packaging, extension viability or offline cold restart.
