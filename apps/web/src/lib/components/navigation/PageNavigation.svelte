<script lang="ts">
	import { getAccountNavigation } from '../../runtime/navigation.js'
	const navigation = getAccountNavigation()
</script>

<div class="navigation-spacer" data-open={navigation.open} aria-hidden="true"></div>

<style>
	.navigation-spacer {
		inline-size: calc(var(--app-control-size, 44px) + var(--dui-spacing-md));
		block-size: var(--app-control-size, 44px);
		transition: inline-size var(--dui-drawer-duration, 225ms);
	}

	.navigation-spacer[data-open='true'] {
		inline-size: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.navigation-spacer {
			transition: none;
		}
	}
</style>
