import { createInstance } from 'i18next'
import type { RecoveryMessages } from 'delightful-local-first/recovery/messages'

const english = {
	title: 'Delightful Clipper',
	starting: 'Opening your account…',
	signedOut: 'Create an account or restore your existing account with its recovery phrase.',
	create: 'Create account',
	restore: 'Restore account',
	phrase: 'Recovery phrase',
	working: 'Updating your account…',
	openingLibrary: 'Preparing your private library…',
	localSaved: 'Library saved on this device. Sync pending.',
	synced: 'Private library synced.',
	syncFailed: 'Library saved on this device, but sync failed. Retry when connected.',
	rootFailed: 'The library could not be saved on this device. Retry to continue.',
	conflict: 'The existing library has an incompatible format. It was not overwritten.',
	unavailable: 'The account is unavailable. Retry to reconnect.',
	configuration: 'Account service is not configured for this deployment.',
	identityFailed:
		'The account operation could not be completed. Check the current account status before retrying.',
	restoreInvalid: 'That recovery phrase is invalid. Check it and try again.',
	restoreFailed: 'The account could not be restored. Check the phrase and connection, then retry.',
	retry: 'Retry',
	logout: 'Sign out',
	recoveryDescription:
		'Keep your recovery phrase somewhere safe so you can restore this account on another device.',
	recoveryHeading: 'Account recovery phrase',
	showRecovery: 'Show recovery phrase',
	recoveryWarning: 'Anyone with this phrase can access your account. Keep it private.',
	close: 'Close',
	recoveryPending: 'Loading recovery phrase…',
	recoveryFailed: 'The recovery phrase could not be shown. Try again.',
	recoveryUnavailable: 'Account recovery is unavailable.',
	closing: 'Closing your account…',
	ownerFailed: 'The account session stopped unexpectedly. Reload the page to reconnect.',
	cleanupFailed: 'Session cleanup could not be confirmed. Reload the page before continuing.',
	reload: 'Reload page',
	closed: 'Account closed.'
}
const i18n = createInstance()
// Bundled English initialization has no network/backend loading.
void i18n.init({
	lng: 'en',
	fallbackLng: 'en',
	initAsync: false,
	resources: { en: { translation: english } }
})
export const t = (key: keyof typeof english) => i18n.t(key)
export function recoveryMessages(): RecoveryMessages {
	return {
		description: t('recoveryDescription'),
		heading: t('recoveryHeading'),
		show: t('showRecovery'),
		warning: t('recoveryWarning'),
		phraseLabel: t('phrase'),
		close: t('close'),
		pending: t('recoveryPending'),
		failure: t('recoveryFailed'),
		unavailable: t('recoveryUnavailable'),
		retry: t('retry')
	}
}
