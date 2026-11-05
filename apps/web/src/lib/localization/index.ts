import { createInstance } from 'i18next'
import type { RecoveryMessages } from 'delightful-local-first/recovery/messages'
import english from './en.json'

type LeafKeys<T> = {
	[K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafKeys<T[K]>}`
}[keyof T & string]
export type MessageKey = Exclude<
	LeafKeys<typeof english>,
	`nouns.${string}` | `actions.${string}_subject`
>
export type Noun = {
	[K in keyof typeof english.nouns]: K extends `${infer Base}_one` ? Base : never
}[keyof typeof english.nouns]
export type Action = {
	[K in keyof typeof english.actions]: K extends `${infer Verb}_subject` ? Verb : never
}[keyof typeof english.actions]
const i18n = createInstance()
// Bundled JSON is synchronous and works without a translation server or network request.
void i18n.init({
	lng: 'en',
	fallbackLng: 'en',
	initAsync: false,
	// Svelte/DUI render messages as text, including interpolated tag names.
	interpolation: { escapeValue: false },
	resources: { en: { translation: english } }
})
export const t = (key: MessageKey, options: { subject?: string; name?: string } = {}) =>
	i18n.t(key, options)
/** Always pass count: i18next selects CLDR plural forms through Intl.PluralRules. */
export const noun = (subject: Noun, count = 1) => i18n.t(`nouns.${subject}`, { count })
export const action = (verb: Action, subject: Noun, count = 1) =>
	i18n.t(`actions.${verb}_subject`, { subject: noun(subject, count), count })

export function recoveryMessages(): RecoveryMessages {
	return {
		description: t('account.recovery.description'),
		heading: t('account.recovery.heading'),
		show: action('show', 'recovery_phrase'),
		warning: t('account.recovery.warning'),
		phraseLabel: t('account.recovery.phrase_label'),
		close: t('actions.close'),
		pending: t('account.recovery.pending'),
		failure: t('account.recovery.failed'),
		unavailable: t('account.recovery.unavailable'),
		retry: t('actions.retry')
	}
}
