import { writable } from 'svelte/store'
import * as wn from 'webnative'

export const db = writable(undefined)
export const fs = writable(undefined)
export const state = writable(undefined)
export const dbFilePath = wn.path.file('private', 'Apps', 'Delightful Labs', 'Delightful Clipper', 'db.json')
