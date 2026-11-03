import { createInstance } from 'i18next'
import type { RecoveryMessages } from 'delightful-local-first/recovery/messages'

const english = {
	title: 'Delightful Clipper',
	offlinePreparing: 'Preparing offline startup…',
	offlineReady: 'Offline startup prepared on this browser.',
	offlineUpdate: 'An update is ready. Close all Clipper tabs and reopen to apply it safely.',
	offlineFailed: 'Offline startup could not be prepared. You can continue online and retry.',
	offlineUnsupported: 'Offline startup is unavailable in this browser.',
	openOriginal: 'Open original',
	addLink: 'Add Link',
	urlLabel: 'Article URL',
	extract: 'Get article',
	cancel: 'Cancel',
	saveArticle: 'Save article',
	previewHeading: 'Article preview',
	capturePending: 'Resolving and extracting the article…',
	captureSaving: 'Saving on this device…',
	captureSaved: 'Article saved on this device. Sync pending.',
	captureAccepted: 'Article synced.',
	captureRejected:
		'The server rejected this save. Local content may remain available; it is not confirmed on other devices.',
	captureUnknown:
		'Save outcome is uncertain. Check the saved article before trying again. No write was replayed.',
	captureDuplicate: 'Already saved.',
	captureSaveFailed:
		'The article could not be saved on this device. Check available storage before trying again.',
	captureCanceled: 'Saving stopped. Check the saved article before trying again.',
	openArticle: 'Open saved article',
	captureFailure: 'The article could not be fetched. Check the URL and connection, then try again.',
	sourceTooLarge: 'This article exceeds the current save limit. Nothing was saved.',
	invalidUrl: 'Enter a valid public HTTP or HTTPS URL.',
	sessionUnavailable: 'Your account could not be authenticated. Reconnect before trying again.',
	rateLimited: 'Too many capture requests. Wait a minute before trying again.',
	libraryHeading: 'Saved articles',
	libraryEmpty: 'No saved articles on this device yet.',
	libraryListFailed: 'The saved article list is unavailable. Reload to reconnect.',
	readerLoading: 'Opening saved article…',
	readerUnavailable: 'This article is not available on this device. Reconnect and open it again.',
	closeReader: 'Close article',
	textOnly: 'Text preview and reading are available. Images are not downloaded in this version.',
	gatewayDisabled: 'Adding links is not enabled on this deployment.',
	articleSyncPending: 'Sync pending.',
	readerHeading: 'Saved article',

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
