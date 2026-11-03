<script lang="ts">
 import {onMount} from 'svelte'
 import type {ActorRefFrom,SnapshotFrom} from 'xstate'
 import {normalizedSource} from '../capture/source.js'
 import {libraryMachine} from '../machines/capture/library.js'
 import {Button,StatusMessage} from 'delightful-ui'
 import {t} from '../localization/index.js'
 let {actor,gatewayEnabled}:{actor:ActorRefFrom<typeof libraryMachine>;gatewayEnabled:boolean}=$props()
 let snapshot=$state<SnapshotFrom<typeof libraryMachine>>()
 let url=$state('')
 const capture=$derived(snapshot?.context)
 const canAdd=$derived(gatewayEnabled&&snapshot?.can({type:'ADD',url}))
 const sync=$derived(capture?.sync[capture.captureId])
 const originalUrl=$derived.by(()=>{if(capture?.reader?.kind!=='available'||!capture.reader.source)return undefined;try{return normalizedSource(capture.reader.source.finalUrl)}catch{return undefined}})
 const feedback=$derived(capture?.failure==='sourceTooLarge'?'sourceTooLarge':capture?.failure==='invalidUrl'?'invalidUrl':capture?.failure==='sessionUnavailable'?'sessionUnavailable':capture?.failure==='rateLimited'?'rateLimited':'captureFailure')
 onMount(()=>{snapshot=actor.getSnapshot();const subscription=actor.subscribe(next=>snapshot=next);return()=>{subscription.unsubscribe();url=''}})
</script>
{#if capture}
<section aria-label={t('addLink')}>
 <h2>{t('addLink')}</h2>
 {#if !gatewayEnabled}<StatusMessage text={t('gatewayDisabled')}/>{/if}
 <form onsubmit={event=>{event.preventDefault();actor.send({type:'ADD',url})}}>
 <label for="article-url">{t('urlLabel')}</label>
 <input id="article-url" name="url" type="url" bind:value={url} required maxlength="8192" autocomplete="url" disabled={!canAdd}/>
 <Button type="submit" disabled={!canAdd}>{t('extract')}</Button>
 </form>
 {#if snapshot?.matches({running:{capture:'preparing'}})}<StatusMessage text={t('capturePending')}/>{/if}
 {#if snapshot?.matches({running:{capture:'saving'}})}<StatusMessage text={t('captureSaving')}/>{/if}
 {#if snapshot?.matches({running:{capture:'failed'}})}<StatusMessage variant="error" text={t(feedback)}/>{/if}
 {#if snapshot?.matches({running:{capture:'preview'}}) && capture.preview}
 <section aria-label={t('previewHeading')}>
 <h3>{capture.preview.title}</h3>
 <p>{capture.preview.finalUrl}</p>
 <StatusMessage text={t('textOnly')}/>
 <p class="preview">{capture.preview.text}</p>
 <Button type="button" onclick={()=>actor.send({type:'SAVE'})}>{t('saveArticle')}</Button>
 </section>
 {/if}
 {#if snapshot?.can({type:'CANCEL'})}<Button type="button" onclick={()=>actor.send({type:'CANCEL'})}>{t('cancel')}</Button>{/if}
 {#if snapshot?.matches({running:{capture:'saveFailed'}})}<StatusMessage variant="error" text={t('captureSaveFailed')}/>{/if}
 {#if snapshot?.matches({running:{capture:'canceled'}})}<StatusMessage text={t('captureCanceled')}/>{/if}
 {#if snapshot?.matches({running:{capture:'duplicate'}})}<StatusMessage text={t('captureDuplicate')}/>{/if}
 {#if snapshot?.matches({running:{capture:'uncertain'}})}<StatusMessage variant="error" text={t('captureUnknown')}/>{/if}
 {#if snapshot?.matches({running:{capture:'saved'}})}<StatusMessage variant={sync==='rejected'?'error':'info'} text={t(sync==='accepted'?'captureAccepted':sync==='rejected'?'captureRejected':'captureSaved')}/>{/if}
 {#if snapshot?.matches({running:{capture:'saved'}})||snapshot?.matches({running:{capture:'duplicate'}})||snapshot?.matches({running:{capture:'uncertain'}})||snapshot?.matches({running:{capture:'canceled'}})}
 <Button type="button" onclick={()=>actor.send({type:'OPEN',id:capture?.captureId ?? ''})}>{t('openArticle')}</Button>
 {/if}
</section>
<section aria-label={t('libraryHeading')}>
 <h2>{t('libraryHeading')}</h2>
 {#if capture.listFailed}<StatusMessage variant="error" text={t('libraryListFailed')}/>{/if}
 {#if !capture.rows.length}<p>{t('libraryEmpty')}</p>{/if}
 <ul>{#each capture.rows as row (row.id)}<li><Button type="button" disabled={capture.writing&&row.id===capture.captureId} onclick={()=>actor.send({type:'OPEN',id:row.id})}>{row.title}</Button>{#if capture.sync[row.id]}<span>{t(capture.sync[row.id]==='rejected'?'captureRejected':capture.sync[row.id]==='accepted'?'captureAccepted':'articleSyncPending')}</span>{/if}</li>{/each}</ul>
</section>
{#if snapshot?.matches({running:{reading:'loading'}})}<StatusMessage text={t('readerLoading')}/>{/if}
{#if capture.reader}
 <section aria-label={t('readerHeading')}>
 <Button type="button" onclick={()=>actor.send({type:'CLOSE_READER'})}>{t('closeReader')}</Button>
 {#if capture.reader.kind==='available'}
 <article><h2>{capture.reader.document.title}</h2>{#if originalUrl}<a href={originalUrl} target="_blank" rel="noreferrer">{t('openOriginal')}</a>{/if}<StatusMessage text={t('textOnly')}/><div class="reader">{capture.reader.text}</div></article>
 {:else}<StatusMessage variant="error" text={t('readerUnavailable')}/>{/if}
 </section>
{/if}
{/if}
<style>
 section{margin-block:1.5rem}form{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center}input{flex:1;min-width:12rem;padding:.6rem;font:inherit}li{margin-block:.75rem}li span{display:block;font-size:.875rem}.preview{white-space:pre-wrap;max-height:20rem;overflow:auto}.reader{white-space:pre-wrap;line-height:1.7;max-width:70ch;margin-inline:auto;overflow-wrap:anywhere}
</style>
