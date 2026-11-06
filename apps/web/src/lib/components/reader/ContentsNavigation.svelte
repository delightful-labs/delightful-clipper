<script lang="ts">
	import { Details, Icon } from 'delightful-ui'
	import { t } from '../../localization/index.js'
	import type { ReaderHeading } from '../../reader/structure.js'
	let { headings, onnavigate }: { headings: ReaderHeading[]; onnavigate?: () => void } = $props()
</script>

{#if headings.length}
	<Details summary={t('reader.contents')}>
		{#snippet caret(expanded)}
			<Icon><path d={expanded ? 'm6 9 6 6 6-6' : 'm9 6 6 6-6 6'} /></Icon>
		{/snippet}
		<nav aria-label={t('reader.contents')} data-reader-contents>
			<ol>
				{#each headings as heading (heading.id)}<li>
						<a href={'#' + heading.id} onclick={onnavigate}>{heading.text}</a>
					</li>{/each}
			</ol>
		</nav>
	</Details>
{/if}
