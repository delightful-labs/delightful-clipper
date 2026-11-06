<script lang="ts">
	import type { AssetResult } from '../contracts/storage.js'
	import { savedContent } from '../reader/content.js'

	type Content = {
		asset: AssetResult
		text: string
		sourceUrl: string | undefined
		onready?: ((node: HTMLElement) => void) | undefined
		onrelease?: (() => void) | undefined
		onlink?: ((event: MouseEvent, node: HTMLElement) => void) | undefined
	}
	let {
		asset,
		text,
		sourceUrl,
		onready,
		onrelease,
		onlink
	}: {
		asset: AssetResult
		text: string
		sourceUrl?: string | undefined
		onready?: (node: HTMLElement) => void
		onrelease?: () => void
		onlink?: (event: MouseEvent, node: HTMLElement) => void
	} = $props()

	function render(node: HTMLElement, input: Content) {
		let current = input
		const link = (event: MouseEvent) => current.onlink?.(event, node)
		node.addEventListener('click', link)
		let previous:
			| {
					bytes: Uint8Array | undefined
					mediaType: string | undefined
					text: string
					sourceUrl: string | undefined
			  }
			| undefined

		function update(value: Content) {
			current = value
			const bytes = value.asset.kind === 'available' ? value.asset.bytes : undefined
			const mediaType = value.asset.kind === 'available' ? value.asset.mediaType : undefined
			// Typed arrays are not Svelte proxies; preserve selection/focus during unrelated updates.
			if (
				previous &&
				previous.bytes === bytes &&
				previous.mediaType === mediaType &&
				previous.text === value.text &&
				previous.sourceUrl === value.sourceUrl
			)
				return
			if (previous) value.onrelease?.()
			previous = { bytes, mediaType, text: value.text, sourceUrl: value.sourceUrl }
			const fragment = savedContent(value.asset, node.ownerDocument, value.sourceUrl)
			node.classList.toggle('plain', !fragment)
			node.replaceChildren(fragment ?? node.ownerDocument.createTextNode(value.text))
			value.onready?.(node)
		}

		update(input)
		return {
			update,
			destroy: () => {
				current.onrelease?.()
				node.removeEventListener('click', link)
				previous = undefined
				node.replaceChildren()
			}
		}
	}
</script>

<div class="reader" use:render={{ asset, text, sourceUrl, onready, onrelease, onlink }}></div>

<style>
	.reader {
		font-family: var(--reader-font, Georgia, serif);
		font-size: var(--reader-size, 20px);
		line-height: var(--reader-spacing, 1.6);
		max-width: var(--reader-width, 65ch);
		margin-inline: auto;
		overflow-wrap: anywhere;
	}

	.reader:global(.plain) {
		white-space: pre-wrap;
	}

	.reader :global(pre) {
		white-space: pre-wrap;
	}

	.reader :global(svg) {
		max-width: 100%;
		height: auto;
	}

	.reader :global(table) {
		display: block;
		max-width: 100%;
		overflow-x: auto;
		border-collapse: collapse;
	}

	.reader :global(th),
	.reader :global(td) {
		border: 1px solid currentColor;
		padding: 0.4rem;
		text-align: start;
	}

	.reader :global(blockquote) {
		border-inline-start: 2px solid currentColor;
		padding-inline-start: 1rem;
		margin-inline: 0;
	}

	.reader :global([id]) {
		scroll-margin-block: 1rem;
	}
</style>
