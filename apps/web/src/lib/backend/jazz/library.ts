import { ImageFetchError, retryAfterMilliseconds } from '../../images/failure.js'
import { readResponseBytes } from '../../machines/capture/article-worker-io.js'
import { captureErrorSchema } from '../../contracts/capture-response.js'
import { IMAGE_INPUT_LIMIT } from '../../images/schema.js'
import { PUBLIC_FAKE_DATA } from '$app/env/public'
import { openSearchWorker } from '../../search/browser.js'
import type { LibraryCapability } from '../../contracts/library.js'
import { createActor, toPromise } from 'xstate'
import { createArticleWorkerHostMachine } from '../../machines/capture/article-worker-host.js'
import { openArticleWorkerBrowser } from '../../machines/capture/article-worker-browser.js'
import { readCaptureResponse } from '../../machines/capture/article-worker-io.js'
import { inspectMachines } from '../../diagnostics/inspect.js'
import { debugEnabled } from '../../diagnostics/logger.js'
import type { LibraryRecords } from './records.js'
/** Binding only. The library owns saving, worker lifetime and SDK leaf resources. */
export function createLibraryCapability(
	records: LibraryRecords,
	_libraryId: string,
	request: (
		mode: 'resolve' | 'extract' | 'asset',
		body: unknown,
		signal: AbortSignal
	) => Promise<Response>,
	cacheNamespace: string
): LibraryCapability {
	const workerMachine = createArticleWorkerHostMachine({
		libraryId: records.articles.libraryId,
		isCurrent: records.isCurrent,
		debug: debugEnabled,
		online: () => navigator.onLine,
		open: (report) => openArticleWorkerBrowser(records, report),
		network: (call, signal) => readCaptureResponse(request, call, signal, records.isCurrent),
		lookup: async (call) =>
			call.method === 'document'
				? { method: 'document', exists: await records.hasDocument(call.operationId) }
				: { method: 'intent', exists: await records.hasIntent(call.operationId) },
		save: records.articles.saveMachine,
		failure: records.articles.failure
	})
	return {
		reader: records.reader.capability,
		images: {
			...records.images.capability,
			request: async (url, id, signal) => {
				const response = await request(
					'asset',
					{ protocolVersion: 1, operationId: id, url },
					signal
				)
				const bytes = await readResponseBytes(
					response,
					signal,
					records.isCurrent,
					IMAGE_INPUT_LIMIT
				)
				if (!response.ok) {
					let error: unknown
					try {
						error = JSON.parse(new TextDecoder().decode(bytes))
					} catch {
						throw new Error('invalidResponse')
					}
					const parsed = captureErrorSchema.safeParse(error)
					throw new ImageFetchError(
						parsed.success ? parsed.data.code : 'invalidResponse',
						retryAfterMilliseconds(response.headers.get('retry-after'))
					)
				}
				return {
					bytes,
					mediaType: (response.headers.get('content-type') ?? '').split(';')[0]!.toLowerCase()
				}
			}
		},
		spawnFakeData: (spawn) =>
			spawn(records.fakeData(PUBLIC_FAKE_DATA === 'true'), { input: undefined }),
		libraryId: records.articles.libraryId,
		search: {
			isCurrent: records.isCurrent,
			libraryId: cacheNamespace + ':' + records.articles.libraryId,
			load: records.searchDocuments,
			observe: records.observeSearch,
			open: openSearchWorker
		},
		spawnOrganization: (spawn, request) =>
			spawn(records.articles.organization.machine, { input: request }),
		isCurrent: records.isCurrent,
		read: records.readCapabilities,
		subscribe: records.articles.subscribe,
		spawnSave: (spawn, input) => spawn(records.articles.saveMachine, { input }),
		worker: (report) => {
			const actor = createActor(workerMachine, {
				input: { report },
				inspect: inspectMachines
			}).start()
			const stopped = toPromise(actor).then(() => {})
			return {
				send: (event) => {
					if (actor.getSnapshot().status === 'active') actor.send(event)
				},
				stop: () => {
					if (actor.getSnapshot().status === 'active') actor.send({ type: 'STOP' })
					return stopped
				}
			}
		}
	}
}
