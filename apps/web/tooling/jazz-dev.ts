import { createActor, fromPromise, setup, assign, toPromise, stateIn } from 'xstate'
import type { Jazz } from 'jazz-tools/backend'
import { isRunnableDevEnvironment, type Plugin, type ViteDevServer } from 'vite'

type Context = { server: ViteDevServer; backend?: Jazz; failed: boolean }
const actors = {
	load: fromPromise<Jazz, ViteDevServer>(async ({ input }) => {
		// Use the same SSR module graph as hooks and routes, so local requests
		// share one SDK-owned backend rather than independent memory stores.
		const environment = input.environments.ssr
		if (!isRunnableDevEnvironment(environment))
			throw new Error('Jazz requires the SSR module runner')
		const module = await environment.runner.import('/src/lib/server/jazz.ts')
		return module.jazz
	}),
	attach: fromPromise(({ input }: { input: Context }) => {
		if (!input.backend || !input.server.httpServer) throw new Error('Jazz dev backend unavailable')
		return input.backend.attach(input.server.httpServer)
	}),
	close: fromPromise(({ input }: { input: Jazz }) => input.close())
}
const lifecycle = setup<
	Context,
	{ type: 'CLOSE' } | { type: 'LISTEN' },
	typeof actors,
	{},
	{},
	{ loadingCancelled: undefined; attachingCancelled: undefined; startupFailed: undefined },
	never,
	string,
	ViteDevServer
>({
	actors,
	guards: {
		loadingCancelled: stateIn('#clipper-jazz-dev.loading.stopping'),
		attachingCancelled: stateIn('#clipper-jazz-dev.attaching.stopping'),
		startupFailed: ({ context }) => context.failed
	}
}).createMachine({
	id: 'clipper-jazz-dev',
	context: ({ input }) => ({ server: input, failed: false }),
	initial: 'waiting',
	states: {
		waiting: { on: { LISTEN: 'loading', CLOSE: 'closed' } },
		loading: {
			initial: 'active',
			states: { active: {}, stopping: {} },
			on: { CLOSE: '.stopping' },
			invoke: {
				src: 'load',
				input: ({ context }) => context.server,
				onDone: [
					{
						guard: 'loadingCancelled',
						target: 'closing',
						actions: assign({ backend: ({ event }) => event.output })
					},
					{ target: 'attaching', actions: assign({ backend: ({ event }) => event.output }) }
				],
				onError: 'failed'
			}
		},
		attaching: {
			initial: 'active',
			states: { active: {}, stopping: {} },
			on: { CLOSE: '.stopping' },
			invoke: {
				src: 'attach',
				input: ({ context }) => context,
				onDone: [{ guard: 'attachingCancelled', target: 'closing' }, { target: 'active' }],
				onError: { target: 'closing', actions: assign({ failed: true }) }
			}
		},
		active: { on: { CLOSE: 'closing' } },
		closing: {
			invoke: {
				src: 'close',
				input: ({ context }) => context.backend!,
				onDone: [{ guard: 'startupFailed', target: 'failed' }, { target: 'closed' }],
				onError: 'failed'
			}
		},
		closed: { type: 'final' },
		failed: { type: 'final' }
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
			server.httpServer?.once('close', () => owner?.send({ type: 'CLOSE' }))
			server.httpServer?.once('listening', () => owner?.send({ type: 'LISTEN' }))
			owner.start()
		},
		async closeBundle() {
			owner?.send({ type: 'CLOSE' })
			await settled
		}
	}
}
