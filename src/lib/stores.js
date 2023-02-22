import { writable } from 'svelte/store'

//User defined settings
export const userSettings = writable({
  fontSize: 20,
  contentWidth: 90,
  fontFamily: 'serif',
  fontWeight: 500,
  lineHeight: 15
})