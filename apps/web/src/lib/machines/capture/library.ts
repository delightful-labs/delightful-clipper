import { assign, fromCallback, fromPromise, sendTo, setup } from 'xstate'
import type { LibraryCapability, LibraryEvent, ReceiptWatch } from '../../contracts/library.js'
import type { DocumentHeader, ReadResult, SaveRequest } from '../../contracts/storage.js'
import type { Candidate } from '../../capture/source.js'
type Context = {
	capability: LibraryCapability | undefined
	closing: boolean
	writing: boolean
	controller: AbortController
	url: string
	preview: Candidate | undefined
	captureId: string
	readerId: string
	reader: ReadResult | undefined
	rows: DocumentHeader[]
	listFailed: boolean
	sync: Record<string, 'pending' | 'accepted' | 'rejected'>
	failure: string
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Library unavailable')
	return value
}
const actors = {
	collection: fromCallback<LibraryEvent, LibraryCapability | undefined>(({ input, sendBack }) => {
		try {
			return input?.subscribe(
				(rows) => sendBack({ type: 'ROWS', rows }),
				() => sendBack({ type: 'LIST_FAILED' })
			)
		} catch {
			sendBack({ type: 'LIST_FAILED' })
			return undefined
		}
	}),
	receipts: fromCallback<ReceiptWatch>(({ receive, sendBack }) => {
		let current = true
		receive((event) => {
			void Promise.all(
				event.receipts.map((receipt) => Promise.resolve().then(() => receipt.global()))
			).then(
				() => {
					if (current) sendBack({ type: 'SYNC', id: event.id, status: 'accepted' })
				},
				() => {
					if (current) sendBack({ type: 'SYNC', id: event.id, status: 'rejected' })
				}
			)
		})
		return () => {
			current = false
		}
	}),
	prepare: fromPromise(
		({
			input,
			signal
		}: {
			input: { capability: LibraryCapability; url: string }
			signal: AbortSignal
		}) => input.capability.prepare(input.url, signal)
	),
	save: fromPromise(
		({
			input
		}: {
			input: { capability: LibraryCapability; request: SaveRequest; signal: AbortSignal }
		}) => input.capability.save(input.request, input.signal)
	),
	read: fromPromise(
		({
			input,
			signal
		}: {
			input: { capability: LibraryCapability; id: string }
			signal: AbortSignal
		}) => input.capability.read(input.id, signal)
	)
}
export const libraryMachine = setup<
	Context,
	LibraryEvent,
	typeof actors,
	{},
	{},
	{},
	never,
	string,
	LibraryCapability | undefined
>({ actors }).createMachine({
	id: 'library',
	initial: 'running',
	context: ({ input }) => ({
		capability: input,
		closing: false,
		writing: false,
		controller: new AbortController(),
		url: '',
		preview: undefined,
		captureId: '',
		readerId: '',
		reader: undefined,
		rows: [],
		listFailed: false,
		sync: {},
		failure: ''
	}),
	states: {
		running: {
			type: 'parallel',
			invoke: [
				{ id: 'collection', src: 'collection', input: ({ context }) => context.capability },
				{ id: 'receipts', src: 'receipts' }
			],
			always: { guard: ({ context }) => context.closing && !context.writing, target: 'closed' },
			on: {
				SHUTDOWN: {
					actions: [
						({ context }) => context.controller.abort(),
						assign({
							closing: true,
							preview: undefined,
							reader: undefined,
							rows: [],
							url: '',
							sync: {}
						})
					]
				},
				ROWS: {
					guard: ({ context }) => !context.closing && !!context.capability?.isCurrent(),
					actions: assign({ rows: ({ event }) => event.rows, listFailed: false })
				},
				LIST_FAILED: { actions: assign({ listFailed: true }) },
				SYNC: {
					guard: ({ context }) => !context.closing && !!context.capability?.isCurrent(),
					actions: assign({
						sync: ({ context, event }) => ({ ...context.sync, [event.id]: event.status })
					})
				}
			},
			states: {
				capture: {
					initial: 'idle',
					states: {
						idle: {
							on: {
								ADD: {
									guard: ({ context }) => !!context.capability?.isCurrent(),
									target: 'preparing',
									actions: assign({
										url: ({ event }) => event.url,
										preview: undefined,
										failure: ''
									})
								}
							}
						},
						preparing: {
							invoke: {
								src: 'prepare',
								input: ({ context }) => ({
									capability: required(context.capability),
									url: context.url
								}),
								onDone: [
									{
										guard: ({ event }) => event.output.kind === 'preview',
										target: 'preview',
										actions: assign({
											preview: ({ event }) =>
												event.output.kind === 'preview' ? event.output.candidate : undefined
										})
									},
									{
										guard: ({ event }) => event.output.kind === 'duplicate',
										target: 'duplicate',
										actions: assign({
											captureId: ({ event }) =>
												event.output.kind !== 'preview' ? event.output.id : ''
										})
									},
									{
										target: 'uncertain',
										actions: assign({
											captureId: ({ event }) =>
												event.output.kind !== 'preview' ? event.output.id : ''
										})
									}
								],
								onError: {
									target: 'failed',
									actions: assign({
										failure: ({ event }) =>
											event.error instanceof Error ? event.error.message : 'captureFailed'
									})
								}
							},
							on: { CANCEL: { target: 'idle', actions: assign({ url: '', preview: undefined }) } }
						},
						preview: {
							on: {
								SAVE: {
									target: 'saving',
									actions: assign({ controller: () => new AbortController() })
								},
								CANCEL: { target: 'idle', actions: assign({ preview: undefined, url: '' }) }
							}
						},
						saving: {
							entry: assign({
								writing: true,
								captureId: ({ context }) => required(context.preview).id
							}),
							exit: assign({ writing: false, preview: undefined }),
							invoke: {
								src: 'save',
								input: ({ context }) => {
									const preview = required(context.preview)
									return {
										capability: required(context.capability),
										signal: context.controller.signal,
										request: {
											operationId: preview.id,
											title: preview.title,
											text: preview.text,
											bytes: new TextEncoder().encode(preview.html),
											mediaType: 'text/html',
											source: {
												finalUrl: preview.finalUrl,
												submittedUrl: preview.submittedUrl,
												provenance: preview.provenance
											}
										}
									}
								},
								onDone: [
									{
										guard: ({ event }) => event.output.kind === 'saved',
										target: 'saved',
										actions: [
											assign({
												captureId: ({ event }) => event.output.operationId,
												sync: ({ context, event }) => ({
													...context.sync,
													[event.output.operationId]: 'pending'
												})
											}),
											sendTo('receipts', ({ event }) => ({
												type: 'WATCH',
												id: event.output.operationId,
												receipts: event.output.kind === 'saved' ? event.output.receipts : []
											}))
										]
									},
									{ guard: ({ event }) => event.output.kind === 'failed', target: 'saveFailed' },
									{ guard: ({ event }) => event.output.kind === 'interrupted', target: 'canceled' },
									{
										target: 'uncertain',
										actions: assign({ captureId: ({ event }) => event.output.operationId })
									}
								],
								onError: { target: 'uncertain' }
							},
							on: { CANCEL: { actions: ({ context }) => context.controller.abort() } }
						},
						saved: {
							on: {
								ADD: { target: 'preparing', actions: assign({ url: ({ event }) => event.url }) }
							}
						},
						duplicate: {
							on: {
								ADD: { target: 'preparing', actions: assign({ url: ({ event }) => event.url }) }
							}
						},
						saveFailed: {
							on: {
								ADD: { target: 'preparing', actions: assign({ url: ({ event }) => event.url }) }
							}
						},
						canceled: {
							on: {
								ADD: { target: 'preparing', actions: assign({ url: ({ event }) => event.url }) }
							}
						},
						uncertain: {
							on: {
								ADD: { target: 'preparing', actions: assign({ url: ({ event }) => event.url }) }
							}
						},
						failed: {
							on: {
								ADD: {
									target: 'preparing',
									actions: assign({ url: ({ event }) => event.url, failure: '' })
								}
							}
						}
					}
				},
				reading: {
					initial: 'empty',
					on: {
						OPEN: {
							target: '.loading',
							reenter: true,
							actions: assign({ readerId: ({ event }) => event.id, reader: undefined })
						},
						CLOSE_READER: { target: '.empty', actions: assign({ reader: undefined }) }
					},
					states: {
						empty: {},
						loading: {
							invoke: {
								src: 'read',
								input: ({ context }) => ({
									capability: required(context.capability),
									id: context.readerId
								}),
								onDone: {
									target: 'shown',
									actions: assign({
										reader: ({ context, event }) =>
											context.capability?.isCurrent() ? event.output : undefined
									})
								},
								onError: { target: 'shown', actions: assign({ reader: { kind: 'unavailable' } }) }
							}
						},
						shown: {}
					}
				}
			}
		},
		closed: {
			type: 'final',
			entry: assign({
				capability: undefined,
				preview: undefined,
				reader: undefined,
				rows: [],
				sync: {},
				url: '',
				captureId: '',
				failure: ''
			})
		}
	}
})
