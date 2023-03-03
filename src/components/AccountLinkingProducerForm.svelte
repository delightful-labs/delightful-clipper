<script>
  import { mainService } from '$lib/machines/main'
  import { createMachine, assign, spawn } from 'xstate'
  import { useMachine } from '@xstate/svelte'
  import { createListenerMachine } from '$lib/auth/accountLinking'
  import { page } from '$app/stores'
  import Username from '$lib/schemas/Username'

  export let username = Username.parse({})
  
  const connectionLink = `${$page.url.origin}/request-access?hashedUsername=${username.hashed}&username=${encodeURIComponent(username.full)}`

  const accountLinkingProducerMachine = createMachine({
    initial: 'idle',
    predictableActionArguments: true,
    context: {
      error: '',
      userPin: '',
      pin: [],
      confirmPin: null,
      rejectPin: null,
      listener: null
    },
    states: {
      idle: {
        entry: assign({ listener: (ctx) => spawn(createListenerMachine(username, $mainService.context.authStrategy.accountProducer), 'listener') }),
        on: {
          CHALLENGE: {
            // Save the response for later use.
            actions: assign((_, evt) => evt.data),
            target: 'challenging'
          },
        },
      },
      challenging: {
        initial: 'inputting',
        on: {
          CANCEL: {
            // @TODO: There is something not working here...
            target: 'cancelled',
            actions: [
              (ctx) => ctx.rejectPin()
            ]
          },
          input: {
            // @TODO: implement automatic checking?
            actions: assign({ userPin: (_, evt) => evt.target.value }),
            target: 'challenging.inputting'
          }
        },
        onDone: {
          target: 'success'
        },
        states: {
          inputting: {
            on: {
              submit: [
                { 
                  cond: (ctx) => ctx.pin.join('') === ctx.userPin,
                  target: 'success' 
                },
                { 
                  target: 'failure',
                  actions: assign({ error: 'That code is not correct, please try again' })
                }
              ],
            }
          },
          success: {
            type: 'final'
          },
          failure: {
            // @TODO: Add custom error message to field
          }
        }
      },
      success: {
        entry: (ctx) => ctx.confirmPin()
      },
      cancelled: {
        type: 'final'
      }
    }
  })

  const { state, send } = useMachine(accountLinkingProducerMachine)

  $: console.log($state)

</script>

<p>{JSON.stringify($state.value)}</p>

<!--@TODO: Show initial state with URL and QR code-->
{#if $state.matches('idle') }
  <p>{connectionLink}</p>
{:else if $state.matches('challenging')}
  <form 
    autocomplete="off"
    on:submit|preventDefault={e => send(e)}
  >
    <label for="pin">Enter the connection code from that device to approve this
      connection.</label>
    <input 
      type="text" 
      inputmode="numeric" 
      pattern="\d*"
      maxlength="6"
      minlength="6"
      required
      id="pin" 
      name="pin"
      on:input={e => send(e)}
    />
    <p aria-live="polite">{$state.context.error}</p>
    <input 
      type="submit" 
      value="Submit" 
    />
  </form>

  <button on:click={()=> send({ type: 'CANCEL' })} >Cancel</button>
{:else if $state.matches('success')}
  <p>Success!</p>
{/if}