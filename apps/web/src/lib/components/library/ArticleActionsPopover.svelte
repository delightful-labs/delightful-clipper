<script lang="ts">
	import type { Snippet } from 'svelte'
	import { Button, Icon, Popover } from 'delightful-ui'

	let {
		label,
		descriptionId,
		children
	}: {
		label: string
		descriptionId?: string
		children: Snippet<[dismiss: () => HTMLElement | null]>
	} = $props()
	const id = $props.id()

	function dismiss() {
		document.getElementById(id)?.hidePopover()
		const trigger = document.getElementById(`${id}-trigger`)
		trigger?.focus({ preventScroll: true })
		return trigger
	}

	function handleKey(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return
		event.preventDefault()
		event.stopPropagation()
		dismiss()
	}

	function focusControl(event: ToggleEvent) {
		if (event.newState !== 'open' || !(event.currentTarget instanceof HTMLElement)) return
		const panel = event.currentTarget
		const first = panel.querySelector<HTMLElement>('select:not(:disabled), button:not(:disabled)')
		const target = first ?? panel
		target.focus({ preventScroll: true })
	}
</script>

<Button
	id={`${id}-trigger`}
	class="article-actions-trigger"
	data-article-actions-trigger
	type="button"
	appearance="flat"
	popovertarget={id}
	aria-label={label}
	aria-describedby={descriptionId}
	aria-controls={id}
	aria-haspopup="dialog"
>
	<Icon width="24" height="24">
		<circle cx="5" cy="12" r="1.5" fill="currentColor" />
		<circle cx="12" cy="12" r="1.5" fill="currentColor" />
		<circle cx="19" cy="12" r="1.5" fill="currentColor" />
	</Icon>
</Button>
<Popover
	{id}
	data-article-actions
	role="dialog"
	aria-label={label}
	aria-describedby={descriptionId}
	tabindex={-1}
	onkeydown={handleKey}
	ontoggle={focusControl}
>
	<div class="fields">{@render children(dismiss)}</div>
</Popover>

<style>
	:global(.article-actions-trigger) {
		--dui-button-padding: var(--dui-spacing-xs, 0.5rem);
		inline-size: var(--dui-button-min-height, 44px);
		block-size: var(--dui-button-min-height, 44px);
		display: grid;
		place-items: center;
	}

	.fields {
		display: grid;
		gap: var(--dui-spacing-sm);
		min-inline-size: 0;
	}
</style>
