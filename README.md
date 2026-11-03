# Delightful Clipper

A private, local-first web article reader and browser clipper. The web foundation supports account creation, recovery, session reload and an owner-only private library root. Article capture, reading and extensions remain unbuilt.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm dev
```

The project selects pnpm 10.22.0 and Node 24.22.2. See [tooling documentation](docs/tooling.md) for commands, archive provenance, CI and Netlify configuration.

- [MVP specification](specs/001-jazz-clipper/spec.md)
- [Technical plan](specs/001-jazz-clipper/plan.md)
- [Investigation results](specs/001-jazz-clipper/investigation-results.md)
- [First implementation handoff](specs/001-jazz-clipper/implementation-handoff.md)

The previous prototype and isolated proof scripts are preserved on [archive/pre-jazz-rewrite-2026-11-02](https://github.com/delightful-labs/delightful-clipper/tree/archive/pre-jazz-rewrite-2026-11-02).

All changes use feature branches and pull requests targeting `main`.
