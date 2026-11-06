<script lang="ts">
	import { Button, LoadingSpinner, StatusMessage } from 'delightful-ui'
	import type { ImageView } from '../../images/view-machine.js'
	import { action, t } from '../../localization/index.js'
	let {
		view,
		alt,
		onretry,
		onerror
	}: {
		view: ImageView | undefined
		alt: string
		onretry: () => void
		onerror: (url: string) => void
	} = $props()
</script>

{#if view?.status === 'ready' && view.url}
	<img
		src={view.url}
		{alt}
		onerror={(event) => onerror(event.currentTarget.getAttribute('src') ?? '')}
		decoding="async"
	/>
{:else}
	<span role="img" aria-label={alt || action('get', 'image')}></span>
	{#if !view || view.status === 'pending'}<LoadingSpinner text={action('get', 'image')} />{/if}
	{#if view?.retry}<Button appearance="flat" onclick={onretry}>{t('actions.retry')}</Button>{/if}
{/if}
{#if view?.message}<StatusMessage {...view.message} />{/if}

<style>
	img {
		max-width: 100%;
		height: auto;
	}
</style>
