import { writable } from 'svelte/store'


export const db = writable(undefined)
export const fs = writable(undefined)
export const state = writable(undefined)
export const wn = writable(undefined)

//User defined settings
export const userFontSize = writable(20)
export const userContentWidth = writable(90)