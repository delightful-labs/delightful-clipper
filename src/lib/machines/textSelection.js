import { createMachine, assign } from 'xstate'

/**
 * @param {Selection} sel
 */
function isBackwards(sel) {
  var rg = document.createRange()
  rg.setStart(sel.anchorNode, sel.anchorOffset)
  rg.setEnd(sel.focusNode, sel.focusOffset)
  return !rg.toString()
}

// const anchor = selection?.anchorNode
// const focus = selection?.focusNode
// const string = selection?.toString()

// if (focus === anchor) {
//   const leftover = focus.data.split(string)

//   const left_text = focus.data.substring(0, focus.data.indexOf(string))
//   const right_text = focus.data.substring(focus.data.indexOf(string) + string?.length)

//   console.log(left_text)
//   console.log(right_text)
// }

// Checks
// 1. anchor is the same as focus?
// 2. if so, is there leftover text in the paragraph?
// 3. if not, is forward or reverse?

// Possibilities

// containedInSingleParagraph
// 1. Text is within one paragraph
// 2. Text consists of one complete paragraph

// spansMultipleParagraphs
// 3. Text starts with a complete paragraph and ends with another partial paragraph.
// 4. Text starts with a partial paragraph and ends with another partial paragraph.
// 5. Text starts with a partial paragraph and ends with another complete paragraph.
// 6. Text starts with a complete paragraph and ends with another complete paragraph.

const getTextRightAndLeft = async (focus, string) => {

  /**
   * @param {string} str 
   * @returns {string}
   */
  const removeLineBreaks = (str) => str.replace(/[\r\n]/gm, '')

  const stringWithoutBreaks = removeLineBreaks(string).trim()
  const focusTrimmed = removeLineBreaks(focus.data).trim()
  const left_text = focusTrimmed.substring(0, focusTrimmed.indexOf(stringWithoutBreaks))
  const right_text = focusTrimmed.substring(focusTrimmed.indexOf(stringWithoutBreaks) + stringWithoutBreaks.length)

  const text = {
    left_text: left_text,
    right_text: right_text
  }

  return text
}

const textSelectionMachine = createMachine({
  context: {
    text: '',
    selection: null,
    anchor: null,
    focus: null,
    textBefore: '',
    textAfter: '',
    isBackwards: false
  },
  initial: 'idle',
  id: 'textSelection',
  predictableActionArguments: true,
  on: {
    selectionchange: {
      target: 'debouncing',
    }
  },
  states: {
    idle: {},
    debouncing: {
      entry: assign({ 
        text: (_, evt) => evt.data.selection.toString(),
        selection: (_, evt) => evt.data.selection,
        anchor: (_, evt) => evt.data.selection.anchorNode,
        focus: (_, evt) => evt.data.selection.focusNode,
        isBackwards: (_, evt) => evt.data.selection.toString() && isBackwards(evt.data.selection),
      }),
      after: {
        1000: [
          {
            cond: (ctx) => !ctx.text,
            target: 'idle',
          },
          {
            cond: (ctx) => ctx.anchor.data === ctx.focus.data,
            target: 'gettingSelection.containedInSingleParagraph',
          },
          {
            target: 'gettingSelection.spansMultipleParagraphs'
          }        
        ]
      }
    },
    gettingSelection: {
      states: {
        containedInSingleParagraph: {
          invoke: {
            src: (ctx) => getTextRightAndLeft(ctx.focus, ctx.text),
            onDone: [
              {
                cond: (_, evt) => evt.data.left_text && evt.data.right_text,
                target: 'finished'
              },
              {
                cond: (_, evt) => !evt.data.left_text,
                target: 'gettingPreviousNode'
              },
              {
                target: 'gettingNextNode'
              }
            ]
          }
        },
        spansMultipleParagraphs: {
        },
        gettingPreviousNode: {},
        gettingNextNode: {},
        finished: {}
      }
    }
  }
})

export default textSelectionMachine