import { writable } from 'svelte/store'
import mainMachine from '$lib/machines/mainMachine'
import { useMachine } from '@xstate/svelte'

export const { state, send } = useMachine(mainMachine)


export const db = writable(undefined)
export const fs = writable(undefined)
export const fissionState = writable(undefined)
export const wn = writable(undefined)

//User defined settings
export const userFontSize = writable(20)
export const userContentWidth = writable(90)