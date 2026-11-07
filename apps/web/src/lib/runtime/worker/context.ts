import { getContext } from 'svelte'
import type { LibraryClient } from './client.js'
export type WorkerLibraryContext = { readonly actor: LibraryClient | undefined }
export const workerLibraryContextKey = Symbol('clipper.worker-library')
export const useWorkerLibrary = () => getContext<WorkerLibraryContext>(workerLibraryContextKey)
