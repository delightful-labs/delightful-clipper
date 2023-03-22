import { createMachine, assign, send } from 'xstate'

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
// 1. Text is within one paragraph
// 2. Text consists of one complete paragraph
// 3. Text starts with a complete paragraph and ends with another partial paragraph.
// 4. Text starts with a partial paragraph and ends with another partial paragraph.
// 5. Text starts with a partial paragraph and ends with another complete paragraph.
// 6. Text starts with a complete paragraph and ends with another complete paragraph.

const textSelectionMachine = createMachine({
  context: {
    selection: null,
    anchor: null,
    focus: null,
    textBefore: '',
    textAfter: ''
  },
  initial: 'idle',
  id: 'textSelection',
  predictableActionArguments: true,
  states: {
    idle: {}
  }
})

export default textSelectionMachine