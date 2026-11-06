<script lang="ts">
	import { Popover } from 'delightful-ui'
	import { action, noun } from '../../localization/index.js'
	import type { ReaderFootnote } from '../../reader/structure.js'
	let {
		id,
		note,
		onfullnote,
		onclose
	}: { id: string; note: ReaderFootnote | undefined; onfullnote: () => void; onclose: () => void } =
		$props()
</script>

<Popover
	{id}
	role="note"
	tabindex={-1}
	aria-label={noun('note')}
	ontoggle={(event) => {
		if (event.newState === 'open') event.currentTarget.focus()
		if (event.newState === 'closed' && !event.currentTarget.matches(':popover-open')) onclose()
	}}
>
	{#if note}<p>{note.text}</p>
		<a href={'#' + note.targetId} onclick={onfullnote}>{action('open', 'note')}</a>{/if}
</Popover>
