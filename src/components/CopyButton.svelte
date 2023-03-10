<script>
  import { createMachine, assign, spawn } from 'xstate'
  import { useMachine } from '@xstate/svelte'

  export let content = ''

  const clipboardIsSupported = () => "clipboard" in navigator

  const copyMachine = createMachine({
    initial: clipboardIsSupported() ? 'supported' : 'unsupported',
    predictableActionArguments: true,
    context: {
      content: content
    },
    states: {
      supported: {
        initial: 'idle',
        states: {
          idle: {
            on: {
              COPY: {
                target: 'copying'
              }
            }
          },
          copying: {
            invoke: {
              src: (ctx) => navigator.clipboard.writeText(ctx.content),
              onDone: {
                target: 'copied'
              },
              onError: {
                
              }
            }
          },
          copied: {
            after: {
              3000: {
                target: 'idle'
              }
            }
          }
        }
      },
      unsupported: {},
    }
  })

  const { state, send } = useMachine(copyMachine)

  $: console.log($state.value)
</script>

{#if $state.matches('supported')}
  <button on:click={()=> send({ type: 'COPY' })} disabled={!$state.can('COPY')}>
    {$state.matches('supported.copied') ? 'Copied!' : 'Or Copy to Clipboard'}
  </button>
{:else}
  <p>{content}</p>
{/if}