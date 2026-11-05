<script lang="ts">
	import { Button, Checkbox, RadioGroup, RadioItem } from 'delightful-ui'
	import { libraryViews, type LibraryView } from '../../capture/organization.js'
	import type { Tag } from '../../capture/tags.js'
	import { noun, t } from '../../localization/index.js'
	let {
		view,
		favorites,
		tags,
		selectedTags,
		onfilter,
		ontagfilter
	}: {
		view: LibraryView
		favorites: boolean
		tags: Tag[]
		selectedTags: string[]
		onfilter: (view: LibraryView, favorites: boolean) => void
		ontagfilter: (keys: string[]) => void
	} = $props()
</script>

<div class="filters">
	<RadioGroup label={t('library.status_label')} value={view}>
		{#each libraryViews as status}
			<RadioItem value={status} onchange={() => onfilter(status, favorites)}
				>{status === 'trash' ? noun('trash') : t(`library.views.${status}`)}</RadioItem
			>
		{/each}
	</RadioGroup>
	<Button type="button" aria-pressed={favorites} onclick={() => onfilter(view, !favorites)}
		>{t('library.views.favorites')}</Button
	>
</div>
{#if tags.length}
	<div role="group" aria-label={noun('tag', 2)} class="tag-filters">
		{#each tags as tag (tag.key)}
			<Checkbox
				label={tag.name}
				checked={selectedTags.includes(tag.key)}
				onchange={(event) =>
					ontagfilter(
						event.currentTarget.checked
							? [...selectedTags, tag.key]
							: selectedTags.filter((key) => key !== tag.key)
					)}
			/>
		{/each}
	</div>
{/if}

<style>
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: end;
	}

	.tag-filters {
		display: flex;
		flex-wrap: wrap;
		gap: var(--dui-spacing-sm);
		margin-block: var(--dui-spacing-sm);
	}
</style>
