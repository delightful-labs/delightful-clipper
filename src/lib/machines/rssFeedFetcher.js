import { createMachine, assign } from 'xstate'
import { XMLParser } from "fast-xml-parser"

const parser = new XMLParser()

const rssFeedFetcherMachine = createMachine({
  context: {
    url: 'https://subconscious.substack.com/feed',
    dateLastFetched: undefined,
    feed: null
  },
  id: 'rssFeedFetcher',
  predictableActionArguments: true,
  initial: 'fetching',
  states: {
    // Fetch
    fetching: {
      invoke: {
        src: (ctx) => fetch(
          `/proxy?url=${encodeURI(ctx.url)}`, 
          { method: 'get' })
          .then(res => res.text()
          .then(str => parser.parse(str))
        ),
        onDone: {
          target: 'checkingFeed',
          actions: assign({ feed: (_, evt) => evt.data.rss.channel})
        },
        onError: {
          actions: (_, evt) => console.log(evt)
        } // @TODO: handle error
      }
    },
    parsingXml: {

    },
    checkingFeed: {
      entry: (ctx, evt, meta) => console.log(meta)
    }

    // Parse


    // Send SAVE_ARTICLE to parent when article found
    // OR batch and send multiple at once?
    // I need to make sure that we don't bottleneck.
  }
})

export default rssFeedFetcherMachine