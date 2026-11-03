<script lang="ts">
 import {page} from '$app/state'
 import Reader from '../../../lib/integrations/Reader.svelte'
 import {useLibrary} from '../../../lib/runtime/library-context.js'
 import {StatusMessage} from 'delightful-ui'
 import {t} from '../../../lib/localization/index.js'
 const runtime=useLibrary()
</script>
{#if runtime.actor}
 {#key runtime.actor}{#key page.params.id}<Reader actor={runtime.actor} id={page.params.id??''}/>{/key}{/key}
{:else}<StatusMessage text={t('reader.loading')}/>{/if}
