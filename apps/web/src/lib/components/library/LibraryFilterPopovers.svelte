<script lang="ts">
	import type { Snippet } from 'svelte'
	import { Button, Icon, Popover, ScreenReaderText } from 'delightful-ui'

	let {
		search,
		filters,
		searchLabel,
		filtersLabel
	}: {
		search: Snippet
		filters: Snippet
		searchLabel: string
		filtersLabel: string
	} = $props()
	const id = $props.id()

	function dismissPopover(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !(event.currentTarget instanceof HTMLElement)) return
		event.preventDefault()
		event.stopPropagation()
		event.currentTarget.hidePopover()
		document.getElementById(`${event.currentTarget.id}-trigger`)?.focus()
	}

	function focusControl(event: ToggleEvent) {
		if (event.newState !== 'open' || !(event.currentTarget instanceof HTMLElement)) return
		const panel = event.currentTarget
		const control =
			panel.querySelector<HTMLElement>('input[type="radio"]:checked:not(:disabled)') ??
			panel.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')
		control?.focus()
	}
</script>

<div class="filter-actions">
	<Button id={`${id}-search-trigger`} type="button" popovertarget={`${id}-search`}>
		<Icon width="24" height="24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></Icon
		>
		<ScreenReaderText>{searchLabel}</ScreenReaderText>
	</Button>
	<Popover
		id={`${id}-search`}
		aria-label={searchLabel}
		onkeydown={dismissPopover}
		ontoggle={focusControl}
	>
		<div class="fields">{@render search()}</div>
	</Popover>
	<Button id={`${id}-filters-trigger`} type="button" popovertarget={`${id}-filters`}>
		<Icon width="24" height="24"><path d="M4 5h16l-6 7v6l-4 2v-8z" /></Icon>
		<ScreenReaderText>{filtersLabel}</ScreenReaderText>
	</Button>
	<Popover
		id={`${id}-filters`}
		aria-label={filtersLabel}
		onkeydown={dismissPopover}
		ontoggle={focusControl}
	>
		<div class="fields">{@render filters()}</div>
	</Popover>
</div>

<style>
	.filter-actions {
		display: flex;
		gap: var(--dui-spacing-xs);
		margin-inline-start: auto;
		flex-shrink: 0;
	}

	.filter-actions > :global(button) {
		--dui-button-padding: var(--dui-spacing-xs, 0.5rem);
		inline-size: var(--dui-button-min-height, 44px);
		block-size: var(--dui-button-min-height, 44px);
		display: grid;
		place-items: center;
	}

	.fields {
		display: grid;
		gap: var(--dui-spacing-md);
		min-inline-size: 0;
	}
</style>
