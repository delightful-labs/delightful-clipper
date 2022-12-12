import { createMachine, interpret, assign } from 'xstate'
import { waitFor } from 'xstate/lib/waitFor'
import { json } from '@sveltejs/kit'
import ogs from 'open-graph-scraper'
import { extractMainContent, processWebpageMetadata } from '$lib/utils'
import { assign as immerAssign } from '@xstate/immer'
//@TODO: Refactor uses of XState assign to use Immer?

//@TODO: Change name of route to fetchArticle?

export async function POST({ request }) {
  const fetchArticleMachine = 
/** @xstate-layout N4IgpgJg5mDOIC5QAoC2BDAxgCwJYDswBKAOhgBdyCoApWAe3wDEAne1AJTAEcBXOcgGIIjMCQIA3egGsxaLHkKkKVfLQbM2nHv1jkEk+pnRVGAbQAMAXUtXEoAA71YuU-nsgAHogBMADgAWEgB2AEY-YIA2HwDIgIBmUIsAVgCAGhAAT0Rw0JIAqOSATnjgvyKA0OTknwBfWoz5HAJiMjBKajpGVnYuPgFBMBY2FhIHABsTADN6FlQSJsVWlU6NHu1+vQN8KWM3W1sPJxc3D28EIot8vz8fIsjAnwtoop8M7IQ-POSLX59k0JFZLRO7JeqNDDNJQkKbtKFQYSicQ7GRySFLUiw8jw7a7Ey4czWQ5IEDHVwE9wk86RFIkPzFAIpKq3ZLBIrvHL3EjVIqvYLxV4BHyRIrgkCLFqYuGKBFDEZjSbkGZzBboyUw6XUXFGfGEmzWI7OcmMM6IAIA-KlGpJZJ+eL+Pwci6Rbl2+K2tl+SLxBJ1BritXQsCecgsLCqKAAWXQBAAwoxyGB8EIRIRkVJZKqFOrg6Hw9Ro3GE0n9IY9hSDgaSWTTlTEEU2SQklUHra-CkLMEnYCXTy+QKYsLRWL8PQIHAPBKlIaThTTQgALShJ0Ll2-dcbzfBMVT5btCNdTS9HQCGfGymgc4FbuNoGJGmFUICwI7wOtLHws+1y9myohe7lD48SRGUDyRN2QIkBYwEBBUwFfACfoQtmQYhmGmARoW+DxsmJZfnOdYIMEwIkA2kSsmyoSwYkbxZJyyRQTBDZJJUkShGUr4oa0qZgPhJqEaEoTCiQbFhDcpSxBYPi0R8PjhNyTHPhYNxSQE9T1EAA */
createMachine({
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
