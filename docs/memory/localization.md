# Localization memory: explicit approval before adding copy

This is a standing user instruction for every agent working in this repository.

An agent must never add a translation entry or new user-visible wording to a locale JSON file without first obtaining explicit user approval for that addition. Before asking, the agent must:

1. Search the existing catalog, reusable `actions` templates, plural-aware `nouns`, and current usage sites.
2. Propose the exact key, English text, interpolation variables and every required plural/context form.
3. Give the concrete usage location and reason the wording is needed.
4. Identify the existing keys considered and explicitly confirm why none would work correctly, including reuse through an action template and noun.
5. Wait for the user's explicit approval before adding the entry. Record the approval in the change/PR explanation.

A feature request, a missing translation or a desire for more specific copy is not permission to invent strings. Do not self-approve, infer approval from silence, add speculative variants, or bypass this rule with hardcoded UI text, inline English fallbacks/default values, or a second catalog. New plural forms and changed wording also require approval. Reuse existing approved copy where it fits; never reuse a misleading message merely to avoid asking.

The user's current localization-refactor request explicitly authorizes moving existing copy unchanged, establishing reusable action templates and the initial common-noun plural vocabulary. It is not blanket approval for subsequent additions.

Keep approved messages in `apps/web/src/lib/localization/en.json`, grouped by purpose. Prefer `action()` and `noun()` for the approved common labels; preserve complete sentences for statuses, errors and language-specific grammar. Let i18next select plurals using `count`; never pluralize with string concatenation or English-only conditions.
