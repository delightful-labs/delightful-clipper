import { createMachine, interpret, assign } from 'xstate'
import { waitFor } from 'xstate/lib/waitFor'
import { json } from '@sveltejs/kit'
import ogs from 'open-graph-scraper'
import { extractMainContent, processWebpageMetadata } from '$lib/utils'
import { assign as immerAssign } from '@xstate/immer'
//@TODO: Refactor uses of XState assign to use Immer?

export async function POST({ request }) {
  const fetchArticleMachine = createMachine({
    predictableActionArguments: true,
    context: {
      url: '',
      request: request,
      response: null,
      article: {},
      body: ''
    },
    initial: 'gettingJsonFromRequest',
    states: {
      gettingJsonFromRequest: {
        invoke: {
          src: (ctx) => ctx.request.json(),
          onDone: {
            target: 'fetching',
            actions: assign({ url: (_, evt) => evt.data.url })
          },
          onError: {
            actions: (_, evt) => console.log(evt)
          } //@TODO: send error message back
        }
      },
      //@TODO: check if is valid URL? (Might not need to, since this will be called after has been checked by another function)
      fetching: {
        invoke: {
          src: (ctx) => ogs({ url: ctx.url, downloadLimit: 2000000 }),
          onDone: {
            target: 'extractingMainContent',
            actions: assign({
              response: (_, evt) => evt.data.response,
              //@TODO: handle various uses of articleAutor and author
              article: (_, evt) => processWebpageMetadata(evt.data.result),
              body: (_, evt) => evt.data.response.rawBody,
            })
          },
          onError: {
            actions: (_, evt) => console.log(evt)
          } //@TODO: send error message back
        }
      },
      extractingMainContent: {
        invoke: {
          src: (ctx) => extractMainContent(ctx.body, ctx.article.locale),
          onDone: {
            target: 'done',
            actions: immerAssign((ctx, evt) => {
              ctx.article._rawBody = evt.data.body
              ctx.article.wordCount = evt.data.wordCount
              ctx.article.mimeType = ctx.response.headers['content-type']
            })
          }
        }
      },
      done: {}
    }
  })

  const actor = interpret(fetchArticleMachine).start()

  const doneState = await waitFor(actor, (state) => state.matches('done'))

  return json(doneState.context.article)
}
