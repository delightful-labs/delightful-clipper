# Localization

English copy lives in `apps/web/src/lib/localization/en.json`, imported by the i18next runtime in `index.ts`. Resources stay bundled, including during offline startup. The JSON groups actions, nouns, app labels, account/recovery messages, capture, library, reader and offline feedback. Full sentences retain their context rather than being assembled from fragments.

Before adding or changing copy, follow the binding [approval memory](memory/localization.md). A feature task alone does not authorize a new string: propose its exact key/text/forms, usage reason and why the searched existing catalog cannot be reused, then obtain explicit user approval. This migration and initial vocabulary were explicitly requested by the user.

## Actions and nouns

The i18next interpolation syntax is `{{subject}}`, not `{subject}`:

```json
{
	"actions": { "add_subject": "Add {{subject}}" },
	"nouns": { "article_one": "article", "article_other": "articles" }
}
```

Use the typed helpers rather than constructing labels or choosing suffixes yourself:

```ts
action('add', 'article') // Add article
action('add', 'article', 2) // Add articles
noun('library', 1) // library
noun('library', 2) // libraries
t('capture.status.saved') // complete, contextual status
```

`noun()` always supplies i18next's `count` option, defaulting to 1. English uses `_one` and `_other`; 0 uses `_other` unless an explicitly approved `_zero` form exists. Other languages can require additional CLDR categories, selected by i18next through `Intl.PluralRules`. Do not implement plural selection with `count === 1`, append `s`, or concatenate a number with an English noun to invent a sentence. The noun helper returns a word/phrase, not a numeric quantity label.

The initial approved vocabulary covers accounts, articles, saved articles, libraries, links, pages, notes, highlights, images, tags, recovery phrases and original sources. Shared action templates replace existing create/restore/get/save/open/close/show/reload labels; standalone Cancel, Close, Retry and Sign out remain available when no subject is required. Add link now follows the same sentence case as the other action labels.

`MessageKey`, `Noun` and `Action` derive from the imported JSON, with i18next resource typing. `t()` accepts complete message keys and standalone actions; interpolated action templates and plural nouns go through helpers that require their inputs. UI state/error identifiers are mapped to translation keys without translating or changing the identifiers themselves. Default interpolation escaping stays enabled; render messages as Svelte text, not raw HTML.

This does not add a language selector or claim every language can use the same action/noun grammar. Keep complete messages when grammar or context requires them; any new context-specific variant still needs approval.

References: [i18next interpolation](https://www.i18next.com/translation-function/interpolation), [plurals](https://www.i18next.com/translation-function/plurals), [JSON v4](https://www.i18next.com/misc/json-format), and [grammar/reuse guidance](https://www.i18next.com/principles/best-practices).

## Approval and reuse record for this refactor

Authorization is the user's explicit request to move strings to JSON, introduce `actions.add_subject`-style templates, establish frequently used plural-aware nouns and require approval before future additions.

| Approved setup                                                                           | Usage reason                                                                              | Why previous entries were insufficient                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add/get/save/open/close_subject`                                                        | Existing Add Link, extraction, save and reader controls.                                  | Previous entries repeated complete labels per subject; no generic action templates existed. They are replaced rather than retained as aliases.                            |
| `create/restore/show/reload_subject`                                                     | Existing account creation/restoration, phrase display and reload controls.                | Existing status sentences and headings cannot serve as these action labels. Their former dedicated labels now reuse templates.                                            |
| Account, article, saved article, library, link, page, recovery phrase and original nouns | Subjects already used by those controls and library/reader terminology.                   | Words embedded inside full sentences/labels are not reusable plural-aware noun resources.                                                                                 |
| Note, highlight, image and tag nouns                                                     | The frequent domain vocabulary explicitly requested, covering retained Clipper workflows. | No standalone noun/plural entries existed; existing article or account messages would describe different objects. This does not approve future status/error/heading copy. |

Existing complete messages and standalone actions were moved without new wording. Add Link becomes sentence-case Add link through the shared template. No extra locale, count label, speculative context form or inline fallback was introduced.
