# Repository working agreements

- All subsequent work must use a feature branch and a pull request targeting `main`. Do not push directly to `main`. The specification-baseline reset was a one-time explicit user instruction.
- Use Conventional Commits PR titles: `type(scope): description` (scope optional; `!` before the colon for breaking changes). The PR title workflow validates this format.
- Do not merge a PR without explicit user authorization. Do not configure branch protection or change repository settings unless requested.
- Follow `specs/001-jazz-clipper/spec.md`, `plan.md`, `design-decisions.md`, and `implementation-handoff.md`. Keep accepted scope cuts intact.
- The workspace tooling, account integration and private library root are implemented; capture and reader workflows remain unbuilt. The prototype and isolated proof scripts are archived on `archive/pre-jazz-rewrite-2026-11-02`; do not restore its legacy dependencies or source as the implementation baseline.
- Use the selected strict TypeScript, Svelte 5, XState, DLF identity/recovery, DUI presentation and i18next boundaries. Model state/resource ownership before implementing asynchronous workflows.
- Clipper owns domain schemas/policies and data operations; DLF owns reusable identity/recovery behavior; DUI owns generic presentation. Do not silently adopt a sibling repository's constitution or copy its domain models.
- Separate local persistence from remote acceptance and retain unknown-write recovery. Never claim privacy, offline availability or platform support without the corresponding evidence.
- Complete and report checks appropriate to each PR. Isolated investigation results do not substitute for validation of the actual implementation.
- Keep implementation scoped to the current user request; the current foundation batch adds bounded immutable text/byte repository capabilities to session identity/recovery and the private library root; capture and reader features require subsequent work.
- Localization memory is binding: read [docs/memory/localization.md](docs/memory/localization.md) before changing user-visible copy. Never add a catalog string (including a new plural form or changed wording) without explicit user approval first. The proposal must give its usage reason and confirm, after searching, why no existing string/action/noun would work. General feature authorization is not string approval; do not bypass this with hardcoded text or inline fallbacks.
