import type { EventPayload } from '../src/lib/machines/events.js'
import { types, createActor, setup, toPromise, createAsyncLogic, matchesState } from 'xstate'

import type { Jazz } from 'jazz-tools/backend'
import { isRunnableDevEnvironment, type Plugin, type ViteDevServer } from 'vite'

type Context = { server: ViteDevServer; backend?: Jazz; failed: boolean }
const actors = {
	load: createAsyncLogic<Jazz, ViteDevServer>({
		run: async ({ input }) => {
			// Use the same SSR module graph as hooks and routes, so local requests
			// share one SDK-owned backend rather than independent memory stores.
			const environment = input.environments.ssr
			if (!isRunnableDevEnvironment(environment))
				throw new Error('Jazz requires the SSR module runner')
			const module = await environment.runner.import('/src/lib/server/jazz.ts')
			return module.jazz
		}
	}),
	attach: createAsyncLogic({
		run: ({ input }: { input: Context }) => {
			if (!input.backend || !input.server.httpServer)
				throw new Error('Jazz dev backend unavailable')
			return input.backend.attach(input.server.httpServer)
		}
	}),
	close: createAsyncLogic({ run: ({ input }: { input: Jazz }) => input.close() })
}
const lifecycle = setup({
	schemas: {
		context: types<Context>(),
		events: {
			CLOSE: types<EventPayload<{ type: 'CLOSE' } | { type: 'LISTEN' }, 'CLOSE'>>(),
			LISTEN: types<EventPayload<{ type: 'CLOSE' } | { type: 'LISTEN' }, 'LISTEN'>>()
		},
		input: types<ViteDevServer>(),
		tags: types<string>(),
		children: {
			load: types<import('xstate').ActorRefFrom<(typeof actors)['load']>>(),
			attach: types<import('xstate').ActorRefFrom<(typeof actors)['attach']>>(),
			close: types<import('xstate').ActorRefFrom<(typeof actors)['close']>>()
		}
	},
	actors,
	guards: {
		loadingCancelled: ({ value }: { value: import('xstate').StateValue }) =>
			matchesState({ loading: 'stopping' }, value),
		attachingCancelled: ({ value }: { value: import('xstate').StateValue }) =>
			matchesState({ attaching: 'stopping' }, value),
		startupFailed: ({ context }: { context: Context }) => context.failed
	}
}).createMachine({
	id: 'clipper-jazz-dev',
	context: ({ input }) => ({ server: input, failed: false }),
	initial: 'waiting',
	states: {
		waiting: { on: { LISTEN: { target: 'loading' }, CLOSE: { target: 'closed' } } },
		loading: {
			initial: 'active',
			states: { active: {}, stopping: {} },
			on: { CLOSE: { target: '.stopping' } },
			invoke: {
				id: 'load',
				src: 'load',
				input: ({ context }: { context: Context }) => context.server,
				onDone: (args) => {
					const { event } = args
					if (args.guards.loadingCancelled(args)) {
						return { target: 'closing', context: { backend: event.output } }
					}
					return { target: 'attaching', context: { backend: event.output } }
				},
				onError: { target: 'failed' }
			}
		},
		attaching: {
			initial: 'active',
			states: { active: {}, stopping: {} },
			on: { CLOSE: { target: '.stopping' } },
			invoke: {
				id: 'attach',
				src: 'attach',
				input: ({ context }: { context: Context }) => context,
				onDone: (args) => {
					if (args.guards.attachingCancelled(args)) {
						return { target: 'closing' }
					}
					return { target: 'active' }
				},
				onError: () => {
					return { target: 'closing', context: { failed: true } }
				}
			}
		},
		active: { on: { CLOSE: { target: 'closing' } } },
		closing: {
			invoke: {
				id: 'close',
				src: 'close',
				input: ({ context }: { context: Context }) => context.backend!,
				onDone: (args) => {
					if (args.guards.startupFailed(args)) {
						return { target: 'failed' }
					}
					return { target: 'closed' }
				},
				onError: { target: 'failed' }
			}
		},
		closed: { type: 'final' as const },
		failed: { type: 'final' as const }
	}
})
export function jazzDev(enabled: boolean): Plugin {
	let owner: ReturnType<typeof createActor<typeof lifecycle>> | undefined
	let settled: Promise<unknown> | undefined
	return {
		name: 'clipper-jazz-dev',
		async handleHotUpdate({ file, server }) {
			// The HTTP module and attached sockets must retain the same authority.
			// A backend definition change needs the normal close/start lifecycle.
			const backendFiles = [
				'/src/lib/server/jazz.ts',
				'/src/lib/backend/jazz/schema.ts',
				'/src/lib/backend/jazz/permissions.ts'
			]
			if (!enabled || !backendFiles.some((path) => file.endsWith(path))) return
			await server.restart()
			return []
		},
		async configureServer(server) {
			if (!enabled) return
			owner = createActor(lifecycle, { input: server })
			settled = toPromise(owner)
			void settled.catch(() => undefined)
			server.httpServer?.once('close', () => owner?.send({ type: 'CLOSE' as const }))
			server.httpServer?.once('listening', () => owner?.send({ type: 'LISTEN' as const }))
			owner.start()
		},
		async closeBundle() {
			owner?.send({ type: 'CLOSE' as const })
			await settled
		}
	}
}
