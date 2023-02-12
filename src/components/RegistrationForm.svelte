<script>
  import { createMachine, actions, assign } from 'xstate'
  import { useMachine } from '@xstate/svelte'
  import * as webnative from 'webnative'
  import { mainService } from '$lib/machines/mainMachine'
  import { createFullUsername, setFullUserName, register } from '$lib/auth/registration'

  const registrationMachine =  createMachine({
    initial: 'idle',
    predictableActionArguments: true,
    context: {
      error: '',
      username: '',
      fullUsername: '',
      program: $mainService.context.program,
      authStrategy: $mainService.context.authStrategy
    },
    on: {
      input: {
        target: 'idle',
        actions: [
          assign({username: /** @param {InputEvent & { target: HTMLInputElement }} evt */ (_, evt) => evt.target.value}),
          actions.cancel('debounce'),
          actions.send({type: 'CREATE_FULL_USERNAME'}, { delay: 200, id: 'debounce' }),
        ]
      },
      submit: { target: 'submitting' },
      CREATE_FULL_USERNAME: { target: 'creatingFullUsername' },
      INVALID: { target: 'invalid' }
    },
    states: {
      idle: {
        entry: assign({ error: '' })
      },
      creatingFullUsername: {
        invoke: {
          src: (ctx) => createFullUsername(ctx.username, ctx.program.components.crypto),
          onDone: {
            actions: [
              (ctx, evt) => setFullUserName(evt.data, ctx.program.components.storage),
              (_, evt) => assign({ fullUsername: evt.data})
            ],
            target: 'available'
          }
        }
      },
      checkingValidity: {
        invoke: {
          src: (ctx) => ctx.authStrategy.isUsernameValid(ctx.username),
          onDone: [
            {
              cond: (_, evt) => evt.data,
              target: 'checkingAvailability'
            },
            {
              cond: (_, evt) => !evt.data,
              target: 'invalid'
            }
          ],
          onError: { target: 'error' }
        }
      },
      checkingAvailability: {
        invoke: {
          src: (ctx) => ctx.authStrategy.isUsernameAvailable(ctx.username),
          onDone: [
            {
              cond: (_, evt) => evt.data,
              target: 'available'
            },
            {
              cond: (_, evt) => !evt.data,
              target: 'unavailable'
            }
          ],
          onError: { target: 'error' }
        }
      },
      unavailable: {
        entry: assign({ error: 'That username is not available' })
      },
      invalid: {
        entry: assign({ error: 'That username is invalid' })
      },
      available: {
        entry: assign({ error: '' })
      },
      submitting: {
        invoke: {
          src: (ctx, evt) => register(ctx.fullUsername, ctx.program.components.auth),
          onDone: [
            {
              cond: (ctx, evt) => evt.data,
              target: 'bootstrappingFs'
            },
            {
              cond: (ctx, evt) => !evt.data,
              target: 'error'
            }
          ],
          onError: { target: 'error' }
        }
      },
      bootstrappingFs: {
        invoke: {
          src: () => webnative.bootstrapRootFileSystem(),
          onDone: {
            target: 'success'
          },
          onError: { target: 'error' }
        }
      },
      success: {
        //@TODO: Add success message
        //And allow users to dismiss.
        //And send username to mainService
        entry: () => mainService.send('REGISTRATION_SUCCEEDED')
      },
      error: {
        entry: assign({ error: 'Sorry, we have experienced a network error. Please check internet connection or try again.' })
      }
    }
  })

  const { state, send } = useMachine(registrationMachine)

  /**
   * Used to bind username input field
   * @type {null|HTMLInputElement}
   */
  let field = null

  /**
   * Sets a custom error message on the field
   * @param {string} err
   */
  const setError = (err) => {
    if (field) field.setCustomValidity(err)
  }

  $: setError($state.context.error)

</script>

<p>{$state.value}</p>

<form 
  autocomplete="off"
  on:submit|preventDefault={e => send(e)}
>
  <label for="username">Choose Username</label>
  <input 
    type="text"
    required
    id="username" 
    name="username"
    on:input={e => send(e)}
    bind:this={field}
  />
  <input 
    type="submit" 
    value="Register" 
    disabled={$state.value !== 'available'} 
  />
  <p>{$state.context.error}</p>
</form>
