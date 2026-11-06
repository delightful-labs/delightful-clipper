<script lang="ts">
	import { Button, Heading } from 'delightful-ui'
	import type { LibraryArticle } from '../../contracts/articles.js'
	import type { OrganizationRequest } from '../../capture/organization.js'
	import { articleHref } from '../../reader/routes.js'
	import { t } from '../../localization/index.js'
	import ReadingProgress from '../reader/ReadingProgress.svelte'
	import ArticleActions from './ArticleActions.svelte'
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
		onorganize: (request: OrganizationRequest) => void
		ontrash: (trigger: HTMLElement) => void
		ontags: (trigger: HTMLElement) => void
		onretry: () => void
	} = $props()
</script>

<li {id} tabindex="-1" data-article-id={row.id}>
	<div class="article-header">
		<div class="article-title">
			<Heading level="h3" size="xl">
				{#if readable}<a href={articleHref(row.id)}>{row.title}</a>{:else}{row.title}{/if}
			</Heading>
		</div>
		<ArticleActions {row} {enabled} {onorganize} {ontrash} {ontags} />
	</div>
	<ReadingProgress value={row.readingProgress} />
	{#if !readable && row.failure}
		<Button type="button" onclick={onretry}>{t('actions.retry')}</Button>
	{/if}
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
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--dui-spacing-sm);
	}

	.article-title {
		flex: 1 1 16rem;
		min-inline-size: 0;
	}
</style>
