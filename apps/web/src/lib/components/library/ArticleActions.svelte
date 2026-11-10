<script lang="ts">
	import { Button, Select } from 'delightful-ui'
	import type { LibraryArticle } from '../../contracts/articles.js'
	import {
		articleStatuses,
		isArticleStatus,
		type OrganizationRequest
	} from '../../capture/organization.js'
	import { action, noun, t } from '../../localization/index.js'
	let {
		row,
		enabled,
		onorganize,
		ontrash,
		ontags
	}: {
		row: LibraryArticle
		enabled: boolean
		onorganize: (request: OrganizationRequest) => void
		ontrash: (trigger: HTMLElement) => void
		ontags: (trigger: HTMLElement) => void
	} = $props()
</script>

<div class="organization-controls">
	<Select
		label={t('library.status_label')}
		value={row.status ?? 'inbox'}
		disabled={!enabled}
		onchange={(event) => {
			const value = event.currentTarget.value
			if (isArticleStatus(value)) onorganize({ id: row.id, field: 'status', value })
		}}
	>
		{#each articleStatuses as status}
			<option value={status}>{t(`library.views.${status}`)}</option>
		{/each}
	</Select>
	<Button
		type="button"
		appearance="flat"
		aria-pressed={row.favorite === true}
		disabled={!enabled}
		onclick={() => onorganize({ id: row.id, field: 'favorite', value: !row.favorite })}
		>{t(row.favorite ? 'library.unfavorite' : 'library.favorite')}</Button
	>
	<Button
		type="button"
		appearance="flat"
		disabled={!enabled}
		onclick={(event) => ontrash(event.currentTarget)}
		>{row.trashed ? action('restore', 'article') : action('move_to', 'trash')}</Button
	>
	<Button appearance="flat" disabled={!enabled} onclick={(event) => ontags(event.currentTarget)}
		>{noun('tag', 2)}</Button
	>
</div>

<style>
	.organization-controls {
		display: grid;
		gap: var(--dui-spacing-sm);
	}
</style>
