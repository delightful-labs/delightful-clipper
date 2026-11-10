<script lang="ts">
	import { Heading } from 'delightful-ui'
	import PageNavigation from '../../lib/components/navigation/PageNavigation.svelte'
	import { getAccountSettings } from '../../lib/runtime/account-settings.js'
	import { noun } from '../../lib/localization/index.js'
	const settings = getAccountSettings()
</script>

<section aria-label={noun('account')}>
	<div class="account-heading">
		<PageNavigation />
		<Heading level="h1" size="xxl">{noun('account')}</Heading>
	</div>
	<div class="account-settings">{@render settings.controls()}</div>
</section>

<style>
	.account-heading {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: start;
	}

	.account-settings {
		max-inline-size: 40rem;
	}
</style>
