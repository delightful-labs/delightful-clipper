import { getContext } from 'svelte'
import type { ActorRefFrom } from 'xstate'
import type { libraryMachine } from '../machines/capture/library.js'
export type LibraryContext = {
	readonly actor: ActorRefFrom<typeof libraryMachine> | undefined
	readonly gatewayEnabled: boolean
}
export const libraryContextKey = Symbol('clipper.library')
export const useLibrary = () => getContext<LibraryContext>(libraryContextKey)
