import { writable } from 'svelte/store'
import mainMachine from '$lib/machines/mainMachine'
import { useMachine } from '$lib/useMachine'

export const { state, send } = useMachine(mainMachine)

export const db = writable(undefined)
export const fs = writable(undefined)
export const fissionState = writable(undefined)
export const wn = writable(undefined)

//User defined settings
export const userSettings = writable({
  fontSize: 20,
  contentWidth: 90,
  fontFamily: 'serif',
  fontWeight: 500,
  lineHeight: 15
})