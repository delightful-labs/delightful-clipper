import 'i18next'
import type english from './en.json'
declare module 'i18next' {
	interface CustomTypeOptions {
		defaultNS: 'translation'
		strictKeyChecks: true
		resources: { translation: typeof english }
	}
}
