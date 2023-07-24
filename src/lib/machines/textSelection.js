import { createMachine, assign } from 'xstate'
import * as textPosition from 'dom-anchor-text-position'
import * as textQuote from 'dom-anchor-text-quote'
import Annotation from '$lib/schemas/Annotation'

/**
 * @returns { import('$lib/schemas/Annotation').Annotation }
 */
const createAnnotation = (textQuote) => {
  return Annotation.safeParse({
    id: 'https://google.com',
    motivation: 'highlighting',
    target: {
      source: 'https://google.com',
      selector: textQuote,
    }
  })
}


const handleSelection = (ctx) => {
  const range = document.getSelection()?.getRangeAt(0)

  //highlightRange(range)
  let position = textPosition.fromRange(ctx.contentContainer, range)
  let selector = textQuote.fromTextPosition(ctx.contentContainer, position)

  console.log(createAnnotation(selector))
}

const textSelectionMachine = createMachine({
  context: {
    text: '',
    selection: null,
    contentContainer: null
  },
  initial: 'idle',
  id: 'textSelection',
  predictableActionArguments: true,
  on: {
    selectionchange: {
      target: 'debouncing',
      actions: assign({ contentContainer: (_, evt) => evt.contentContainer})
    }
  },
  states: {
    idle: {},
    debouncing: {
      entry: [
        assign({ selection: document.getSelection() }),
      ],
      after: {
        500: [
          {
            cond: (ctx) => ctx.selection.toString() != "",
            target: 'hasSelection',
          },
          {
            target: 'idle'
          }
        ]     
      }
    },
    hasSelection: {
      on: {
        CANCEL: {
          target: 'idle'
        },
        SUBMIT: {
          target: 'idle',
          actions: (ctx) => handleSelection(ctx)
        }
      }
    }
  }
})

export default textSelectionMachine