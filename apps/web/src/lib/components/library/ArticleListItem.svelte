<script lang="ts">
	import { Button, Heading } from 'delightful-ui'
	import type { LibraryArticle } from '../../contracts/articles.js'
	import type { OrganizationRequest } from '../../capture/organization.js'
	import { articleHref } from '../../reader/routes.js'
	import { t } from '../../localization/index.js'
	import ReadingProgress from '../reader/ReadingProgress.svelte'
	import ArticleActions from './ArticleActions.svelte'
	import ArticleActionsPopover from './ArticleActionsPopover.svelte'
	let {
		row,
		id,
		readable,
		enabled,
		onorganize,
		ontrash,
		ontags,
		onretry
	}: {
		row: LibraryArticle
		id: string
		readable: boolean
		enabled: boolean
		onorganize: (request: OrganizationRequest, trigger: HTMLElement) => void
		ontrash: (trigger: HTMLElement) => void
		ontags: (trigger: HTMLElement) => void
		onretry: () => void
	} = $props()
</script>

<li {id} tabindex="-1" data-article-id={row.id}>
	<div class="article-header">
		<div id={`${id}-title`} class="article-title">
			<Heading level="h3" size="xl">
				{#if readable}<a href={articleHref(row.id)}>{row.title}</a>{:else}{row.title}{/if}
			</Heading>
		</div>
		<ArticleActionsPopover label={t('library.article_actions')} descriptionId={`${id}-title`}>
			{#snippet children(dismiss)}
				<ArticleActions
					{row}
					{enabled}
					onorganize={(request) => {
						const trigger = dismiss()
						if (trigger) onorganize(request, trigger)
					}}
					ontrash={() => {
						const trigger = dismiss()
						if (trigger) ontrash(trigger)
					}}
					ontags={() => {
						const trigger = dismiss()
						if (trigger) ontags(trigger)
					}}
				/>
				{#if !readable && row.failure}
					<Button
						type="button"
						onclick={() => {
							dismiss()
							onretry()
						}}>{t('actions.retry')}</Button
					>
				{/if}
			{/snippet}
		</ArticleActionsPopover>
	</div>
	<ReadingProgress value={row.readingProgress} />
</li>

<style>
	li {
		margin: 0;
		padding: var(--dui-spacing-sm);
		border-block-end: 1px solid var(--dui-color-foreground);
	}

	li:last-child {
		border-block-end: 0;
	}

	.article-header {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: start;
		gap: var(--dui-spacing-sm);
	}

	.article-title {
		min-inline-size: 0;
		overflow-wrap: anywhere;
	}
</style>
