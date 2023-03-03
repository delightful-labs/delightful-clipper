<script>
  import { createMachine, assign, send as xSend, spawn } from 'xstate'
  import { useMachine } from '@xstate/svelte'
  import { page } from '$app/stores'
  import { createListenerMachine } from '$lib/auth/accountLinking'
  import { mainService } from '$lib/machines/mainMachine'
  import Username from '$lib/schemas/Username'

  const username = Username.parse({
    hashed: $page.url.searchParams.get('hashedUsername'),
    full: $page.url.searchParams.get('username')
  })//$page.url.searchParams.get('username') || '' hashedUsername

  const accountLinkingConsumerMachine = createMachine({
    initial: 'idle',
    predictableActionArguments: true,
    context: {
      userPin: '',
      pin: [],
      confirmPin: null,
      rejectPin: null,
      listener: null
    },
    on: {
      CHALLENGE: {
        // Save the response for later use.
        actions: assign((_, evt) => evt.data),
        target: 'challenging'
      }
    },
    states: {
      idle: {
        entry: assign({ listener: () => spawn(createListenerMachine(username, $mainService.context.authStrategy.accountConsumer), 'listener') })
      },
      challenging: {
        on: {
          LINK: [
            {
              cond: (_, evt) => evt.data.approved,
              target: 'success'
            },
            { target: 'failure' }
          ],
          CANCEL: {
            target: 'cancelled',
            actions: xSend({ type: 'CANCEL' }, { to: 'listener' })
          }
        }
      },
      success: {
        entry: () => mainService.send({type: 'ACCOUNT_LINKED', data: username.full}),
        type: 'final'
      },
      failure: {
        type: 'final',
        entry: (_, evt) => console.log(evt)
      },
      cancelled: {
        type: 'final'
      }
    }
  })

  const { state, send } = useMachine(accountLinkingConsumerMachine)

  $: console.log($state)
</script>

<!--@TODO how to handle state changes for screen readers? aria-live on all the sections?-->
{#if $state.matches('idle')}
  <p>Waiting for other device</p>
{:else if $state.matches('challenging')}
  <p>Your code is: {$state.context.pin.join('')}</p>
  <button on:click={()=> send({ type: 'CANCEL' })} >Cancel</button>
{:else if $state.matches('cancelled')}
  <p>Linking has been cancelled.</p>
{:else if $state.matches('success')}  
  <p>Success!</p>
  <!--@TODO: Load filesystem if success-->
  <!--@TODO: Handle redirect-->
{:else if $state.matches('failure')} 
  <p>The process was cancelled on the host device.</p>
{/if}