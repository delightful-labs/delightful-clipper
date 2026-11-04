<script lang="ts">
	import { useLibrary } from '../../web/src/lib/runtime/library-context.js'
	import { action } from '../../web/src/lib/localization/index.js'
	const library = useLibrary()
	$effect(() => {
		const owner = library.actor
		if (!owner) return
		const accountId = owner.getSnapshot().context.capability?.libraryId
		if (!accountId) return
		void chrome.runtime.sendMessage({ type: 'ACCOUNT_CHANGED', accountId }).catch(() => {})
	})
</script>

<a href={__CLIPPER_WEB__} target="_blank" rel="noreferrer">{action('open', 'library')}</a>
