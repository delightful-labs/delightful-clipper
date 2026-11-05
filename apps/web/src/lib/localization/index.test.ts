import { expect, it } from 'vitest'
import { action, noun, recoveryMessages, t } from './index.js'
import english from './en.json'
it('composes existing action labels from approved verbs and nouns', () => {
	expect(action('add', 'link')).toBe('Add link')
	expect(action('get', 'article')).toBe('Get article')
	expect(action('save', 'article')).toBe('Save article')
	expect(action('open', 'saved_article')).toBe('Open saved article')
	expect(action('open', 'original')).toBe('Open original')
	expect(action('create', 'account')).toBe('Create account')
	expect(action('restore', 'account')).toBe('Restore account')
	expect(action('show', 'recovery_phrase')).toBe('Show recovery phrase')
	expect(action('close', 'article')).toBe('Close article')
	expect(action('reload', 'page')).toBe('Reload page')
	expect(action('search', 'article', 2)).toBe('Search articles')
	expect(action('move_to', 'trash')).toBe('Move to Trash')
	expect(t('actions.remove_name', { name: 'Research & notes' })).toBe('Remove Research & notes')
	expect(t('status.selected_subject_name', { subject: noun('tag'), name: 'Reading' })).toBe(
		'tag Reading selected.'
	)
	expect(t('status.removed_subject_name', { subject: noun('tag'), name: 'Reading' })).toBe(
		'tag Reading removed.'
	)
	expect(t('errors.already_selected_subject_name', { subject: noun('tag'), name: 'Reading' })).toBe(
		'tag Reading is already selected.'
	)
})
it.each([
	[0, 'articles'],
	[1, 'article'],
	[2, 'articles'],
	[21, 'articles'],
	[1.5, 'articles']
] as const)('lets i18next select the noun for count %s', (count, expected) => {
	expect(noun('article', count)).toBe(expected)
})
it('uses the catalog’s irregular plurals instead of appending an English suffix', () => {
	expect(noun('library', 1)).toBe('library')
	expect(noun('library', 0)).toBe('libraries')
	expect(noun('library', 2)).toBe('libraries')
	expect(action('open', 'library', 2)).toBe('Open libraries')
	expect(action('add', 'highlight', 2)).toBe('Add highlights')
})
it('has both English plural forms for every approved noun', () => {
	const rules = new Intl.PluralRules('en')
	expect(rules.select(0)).toBe('other')
	expect(rules.select(1)).toBe('one')
	for (const key of Object.keys(english.nouns))
		if (key.endsWith('_one')) expect(english.nouns).toHaveProperty(key.replace(/_one$/, '_other'))
})
it('keeps standalone actions and contextual feedback separate from composed labels', () => {
	expect(t('actions.close')).toBe('Close')
	expect(t('actions.retry')).toBe('Retry')
	expect(t('actions.sign_out')).toBe('Sign out')
	expect(t('account.status.localSaved')).toBe('Library saved on this device. Sync pending.')
	expect(t('capture.status.saved')).toBe('Article saved on this device. Sync pending.')
	expect(t('forms.enter_subject', { subject: noun('tag') })).toBe('Enter tag')
	expect(t('forms.enter_subject', { subject: noun('article', 2) })).toBe('Enter articles')
	expect(t('connection.online')).toBe('online')
	expect(t('connection.offline')).toBe('offline')
})
it('supplies the existing DLF recovery presentation contract using shared actions', () => {
	const messages = recoveryMessages()
	expect(messages.show).toBe('Show recovery phrase')
	expect(messages.close).toBe(t('actions.close'))
	expect(messages.retry).toBe(t('actions.retry'))
	expect(messages.phraseLabel).toBe('Recovery phrase')
	expect(messages.warning).toBe('Anyone with this phrase can access your account. Keep it private.')
})
