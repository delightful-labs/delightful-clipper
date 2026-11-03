<script lang="ts">
 import {onMount} from 'svelte'
 import {dev} from '$app/env'
 import {createActor} from 'xstate'
 import {stopAfterShutdown} from 'delightful-local-first/forms/lifecycle'
 import {Button,StatusMessage} from 'delightful-ui'
 import {createShellRegistrationMachine} from '../machines/offline/registration.js'
 import type {ShellStatus} from '../machines/offline/registration.js'
 import {observeShell} from '../offline/browser.js'
 import {t} from '../localization/index.js'
 let {onAdmission}:{onAdmission:()=>void}=$props()
 let status=$state<ShellStatus>('preparing')
 let retry=()=>{}
 const message=$derived(status==='ready'?'offlineReady':status==='waiting'?'offlineUpdate':status==='failed'?'offlineFailed':status==='unsupported'?'offlineUnsupported':'offlinePreparing')
 onMount(()=>{
 if(dev){onAdmission();return}
 const machine=createShellRegistrationMachine({register:()=> 'serviceWorker' in navigator?navigator.serviceWorker.register('/service-worker.js',{type:'module',updateViaCache:'none'}):Promise.resolve(undefined),observe:observeShell})
 const actor=createActor(machine)
 const subscription=actor.subscribe(snapshot=>{status=snapshot.context.status;if(snapshot.context.admitted)onAdmission()})
 retry=()=>actor.send({type:'RETRY'})
 actor.start()
 return()=>{subscription.unsubscribe();stopAfterShutdown(actor)}
 })
</script>
{#if !dev}<StatusMessage variant={status==='failed'?'error':'info'} text={t(message)}/>{#if status==='failed'}<Button type="button" onclick={()=>retry()}>{t('retry')}</Button>{/if}{/if}
